/**
 * processArrival -- the processor's use case over one Arrival Record (design
 * Behaviors: Scrubbing removes data, Source map applied, Missing source map,
 * Duplicate arrival; architecture Mechanism, Stream consumption and
 * processing). Reads the record's body, inline or from the BlobStore, and
 * routes each item by kind.
 *
 * An event item is normalized, scrubbed with the Project's Scrubbing Rules,
 * mapped through its Artifacts when it is a browser Event, stored scrubbed with its Removals under `events/<project id>/`, summarized, given its
 * Fingerprints, and assigned through ProjectClient after its Release is
 * recorded as seen. The Issue Changes go to the EffectQueue and the Event
 * Summary to the archive. Processing is idempotent: Event ids key every
 * write, and ProjectDO answers a duplicate Event with the earlier target
 * and no change, so nothing is enqueued or archived twice.
 *
 * A feedback item is filed as a Report through fileReport, with the sign-in
 * Assertion the tunnel forwarded and the ingest Worker retained, under a
 * filing key, so a redelivered record files no second Report. Any other
 * kind (check-ins, sessions, attachments, security reports) is left to its
 * own use case with a `deferred` Outcome.
 *
 * Every Outcome processing decides (an event refused or dropped, a filing
 * refused, an item left to another use case) is archived. A write that fails throws, so the
 * pump retries the record.
 *
 * Ports: ControlStore, BlobStore, ProjectClient, EffectQueue, ArchiveSink,
 * Clock, Ids; and fileReport's SignInVerifier, QuotaGate, SpamJudge, Mailer.
 */

import { deriveFingerprints } from '../domain/grouping/derive.js';
import { eventBlobKey, type EventSummary } from '../domain/event/event-summary.js';
import type { ArrivalRecord } from '../domain/ingest/arrival.js';
import { arrivalEnvelope } from '../domain/ingest/items.js';
import type { Assignment } from '../domain/issue/assignment.js';
import type { Fingerprint } from '../domain/grouping/fingerprint.js';
import { toEventSummary } from '../domain/normalize/event-summary.js';
import { toGroupingInput } from '../domain/normalize/grouping-input.js';
import { normalizeEvent, type NormalizedEvent } from '../domain/normalize/normalize.js';
import type { Outcome, OutcomeKind } from '../domain/outcome/outcome.js';
import {
  encodeScrubbedEvent,
  itemOutcome,
  itemPayload,
  mergeResults,
  normalizeContext,
  processingOutcome,
  processingResult,
  processingRoute,
  userKeyText,
  type ProcessingConfig,
  type ProcessingResult,
  type ProcessingSettings,
} from '../domain/processing/processing.js';
import { sessionReports, type SessionReport } from '../domain/processing/sessions.js';
import type { EnvelopeItem } from '../domain/protocol/envelope.js';
import type { Session } from '../domain/release/health.js';
import { isRefusal } from '../domain/refusal.js';
import type { FilingReceipt, FilingRefusal, ReportSettings } from '../domain/report/filing.js';
import { feedbackSubmission } from '../domain/processing/feedback.js';
import { scrubbingRules } from '../domain/scrub/rules.js';
import { hashedFrom, scrubEvent, textsToHash, type ScrubbedEvent } from '../domain/scrub/scrub.js';
import {
  artifactBlobKey,
  artifactQuery,
  isSourceMapped,
  matchedArtifacts,
  sourceMapLookup,
  type Artifact,
} from '../domain/sourcemap/artifact.js';
import { mapEventFrames } from '../domain/sourcemap/map-frames.js';
import { parseSourceMap, type SourceMap } from '../domain/sourcemap/source-map.js';
import type { ArchiveSink } from '../ports/archive-sink.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Ids } from '../ports/ids.js';
import { fileReport, type FileReportDeps } from './reports/file-report.js';

/** fileReport's ports, for feedback items, and the processor's own. */
export type ProcessArrivalDeps = Omit<FileReportDeps, 'settings'> & {
  readonly archive: ArchiveSink;
  readonly settings: ProcessingSettings;
  readonly reportSettings: ReportSettings;
};

/** One record being processed: the record, its envelope header, and its Project's processing config. */
type Processing = { readonly record: ArrivalRecord; readonly header: Readonly<Record<string, unknown>>; readonly config: ProcessingConfig };

/** An item of the record, with its index among the record's items. */
type Placed = { readonly item: EnvelopeItem; readonly index: number };

type Scrubbed = { readonly scrubbed: ScrubbedEvent; readonly userKey: string | null };

// --- helpers ---

/** The Outcome processing decided for an item, naming it so it supersedes the item's admission Outcome. */
function itemFate(placed: Placed, processing: Processing, fate: { kind: OutcomeKind; reason: string }): Outcome {
  return processingOutcome({ record: processing.record, index: placed.index, type: placed.item.header.type, ...fate });
}

// --- flow: reading the record ---

async function recordBody(record: ArrivalRecord, blobs: BlobStore): Promise<Uint8Array | null> {
  return record.blobKey === null ? record.body : blobs.get(record.blobKey);
}

// --- flow: scrubbing ---

async function hashAll(texts: readonly string[], ids: Ids): Promise<ReadonlyMap<string, string>> {
  return new Map(await Promise.all(texts.map(async (text) => [text, await ids.hash(text)] as const)));
}

/** Scrubs with the Project's rules, hashing ahead what the rules hash, then keys the user by a field no rule touched. */
async function scrub(event: NormalizedEvent, processing: Processing, ids: Ids): Promise<Scrubbed> {
  const rules = scrubbingRules(processing.config.scrubbing);
  const scrubbed = scrubEvent(event, rules, hashedFrom(await hashAll(textsToHash(event, rules), ids)));
  const userText = userKeyText(scrubbed.event, scrubbed.removals);
  return { scrubbed, userKey: userText === null ? null : await ids.hash(userText) };
}

// --- flow: source maps ---

/** The parsed map of an Artifact, by its id; null when its file is gone or is no source map. */
async function loadSourceMap(artifact: Artifact, blobs: BlobStore): Promise<readonly [string, SourceMap] | null> {
  const bytes = await blobs.get(artifactBlobKey(artifact));
  const map = bytes === null ? null : parseSourceMap(bytes);
  return map === null || isRefusal(map) ? null : [artifact.id, map];
}

/** Maps a browser Event's frames through the Artifacts that match them; a frame left minified is recorded on the Event. */
async function applySourceMaps(scrubbed: ScrubbedEvent, processing: Processing, deps: ProcessArrivalDeps): Promise<ScrubbedEvent> {
  const { event } = scrubbed;
  if (!isSourceMapped(event)) return scrubbed;
  const artifacts = matchedArtifacts(event, await deps.control.artifactsFor(processing.record.projectId, artifactQuery(event)));
  const loaded = await Promise.all(artifacts.map((artifact) => loadSourceMap(artifact, deps.blobs)));
  const maps = new Map(loaded.filter((entry) => entry !== null));
  return { ...scrubbed, event: mapEventFrames(event, sourceMapLookup({ event, artifacts, maps })) };
}

// --- flow: storing and assigning ---

async function storeEvent(scrubbed: ScrubbedEvent, processing: Processing, blobs: BlobStore): Promise<void> {
  const key = eventBlobKey({ projectId: processing.record.projectId, eventId: scrubbed.event.eventId });
  const stored = await blobs.put(key, encodeScrubbedEvent(scrubbed));
  if (!stored.ok) throw new Error(`event ${scrubbed.event.eventId} could not be stored (retryable: ${stored.retryable})`);
}

async function assign(
  placement: { summary: EventSummary; fingerprints: readonly Fingerprint[] },
  processing: Processing,
  deps: ProcessArrivalDeps,
): Promise<Assignment> {
  const { projectId } = processing.record;
  if (placement.summary.release !== null) await deps.projects.recordReleaseSeen(projectId, placement.summary.release);
  return deps.projects.assignEvent(projectId, placement.summary, [...placement.fingerprints]);
}

/**
 * What follows an Assignment: a dropped Event's copy is deleted; a new one's
 * changes are enqueued and its Summary archived; a duplicate's were already,
 * so nothing follows it.
 */
async function settle(
  settled: { assignment: Assignment; summary: EventSummary; placed: Placed },
  processing: Processing,
  deps: ProcessArrivalDeps,
): Promise<ProcessingResult> {
  const { assignment, summary, placed } = settled;
  if ('tombstone' in assignment) {
    await deps.blobs.delete(eventBlobKey({ projectId: processing.record.projectId, eventId: summary.eventId }));
    const outcome = itemFate(placed, processing, { kind: 'discarded', reason: 'tombstone' });
    return processingResult({ assignments: [assignment], outcomes: [outcome] });
  }
  if (assignment.duplicate) return processingResult({ assignments: [assignment] });
  if (assignment.changes.length > 0) await deps.effects.enqueue(assignment.changes);
  await deps.archive.events(processing.record.projectId, [summary]);
  return processingResult({ assignments: [assignment] });
}

// --- flow: items ---

async function processEvent(placed: Placed, processing: Processing, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const normalized = normalizeEvent(itemPayload(placed.item), normalizeContext({ ...processing, settings: deps.settings }));
  if (isRefusal(normalized)) {
    const outcome = itemFate(placed, processing, { kind: 'invalid', reason: normalized.refusal });
    return processingResult({ outcomes: [outcome] });
  }
  const { scrubbed, userKey } = await scrub(normalized, processing, deps.ids);
  const mapped = await applySourceMaps(scrubbed, processing, deps);
  await storeEvent(mapped, processing, deps.blobs);

  // Milestone: the Event is stored scrubbed; only now is it counted.
  const summary = toEventSummary(mapped.event, userKey);
  const fingerprints = deriveFingerprints(toGroupingInput(mapped.event), processing.config.grouping);
  const assignment = await assign({ summary, fingerprints }, processing, deps);
  return settle({ assignment, summary, placed }, processing, deps);
}

// --- flow: feedback ---

/** A filing storage could not take is thrown, so the record is retried; any other refusal stands with its Outcome, named as the item. */
function filed(filing: FilingReceipt | FilingRefusal, placed: { record: ArrivalRecord; index: number }): ProcessingResult {
  if (!isRefusal(filing)) return processingResult({ filingReceipts: [filing] });
  if (filing.retryable !== undefined) throw new Error(`feedback could not be filed: ${filing.refusal} (retryable: ${filing.retryable})`);
  return processingResult({ outcomes: filing.outcome === undefined ? [] : [itemOutcome({ outcome: filing.outcome, ...placed })] });
}

/** Files the Report a feedback item carries, as whoever the sign-in the tunnel forwarded names, keyed so a redelivery files nothing new. */
async function fileFeedback(placed: Placed, processing: Processing, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const { record } = processing;
  const submission = feedbackSubmission(placed.item, { recordId: record.id, index: placed.index });
  const filing = await fileReport(record.projectId, submission, record.assertion, { ...deps, settings: deps.reportSettings });
  return filed(filing, { record, index: placed.index });
}

// --- flow: sessions ---

async function hashedSession(report: SessionReport, ids: Ids): Promise<Session> {
  const { userText, ...session } = report;
  return { ...session, userKey: userText === null ? null : await ids.hash(userText) };
}

/** Counts each Session a session item reports through ProjectClient; an item that cannot be read is refused. */
async function recordSessions(placed: Placed, processing: Processing, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const reports = sessionReports(placed.item, processing.record.receivedAt);
  if (isRefusal(reports))
    return processingResult({ outcomes: [itemFate(placed, processing, { kind: 'invalid', reason: reports.refusal })] });
  for (const report of reports) await deps.projects.recordSession(processing.record.projectId, await hashedSession(report, deps.ids));
  return processingResult({});
}

// --- flow: routing ---

async function processItem(placed: Placed, processing: Processing, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const route = processingRoute(placed.item.header.type);
  if (route === 'event') return processEvent(placed, processing, deps);
  if (route === 'feedback') return fileFeedback(placed, processing, deps);
  if (route === 'session') return recordSessions(placed, processing, deps);

  // Milestone: check-ins, sessions, attachments and security reports wait for their own use cases.
  const outcome = itemFate(placed, processing, { kind: 'discarded', reason: 'deferred' });
  return processingResult({ outcomes: [outcome] });
}

async function processItems(items: readonly EnvelopeItem[], processing: Processing, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const results: ProcessingResult[] = [];
  for (const [index, item] of items.entries()) results.push(await processItem({ item, index }, processing, deps));
  return mergeResults(results);
}

// --- flow: the record ---

async function finish(result: ProcessingResult, archive: ArchiveSink): Promise<ProcessingResult> {
  if (result.outcomes.length > 0) await archive.outcomes(result.outcomes);
  return result;
}

function refuseRecord(record: ArrivalRecord, reason: string): ProcessingResult {
  return processingResult({ outcomes: [processingOutcome({ record, index: null, type: record.endpoint, kind: 'invalid', reason })] });
}

// --- exports ---

export async function processArrival(record: ArrivalRecord, deps: ProcessArrivalDeps): Promise<ProcessingResult> {
  const body = await recordBody(record, deps.blobs);
  if (body === null) return finish(refuseRecord(record, 'raw-expired'), deps.archive);
  const envelope = arrivalEnvelope({ endpoint: record.endpoint, body });
  if (isRefusal(envelope)) return finish(refuseRecord(record, envelope.refusal), deps.archive);
  const config = await deps.control.processingConfig(record.projectId);
  if (config === null) return finish(refuseRecord(record, 'unknown-project'), deps.archive);
  return finish(await processItems(envelope.items, { record, header: envelope.header, config }, deps), deps.archive);
}
