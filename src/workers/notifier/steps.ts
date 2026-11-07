/**
 * The notifier steps -- one module function per piece of work an Issue
 * Change from the `effects` queue starts (architecture Mechanism, Alerts and
 * notifications; Code and GitHub), and DigestDO's alarm. The queue handler
 * and DigestDO only forward to these, so no step is a method a bound Worker
 * could call (cloudflare-hosting: every step is a module function).
 *
 * An Issue Change arrives once and is fanned out into one message per step
 * on the same queue: notifyReporters, notifyFollowers, evaluateIssueAlerts,
 * pushIssueChange (which does nothing for an Issue with no External Link),
 * and suggestOwners for a new Issue. Each step message then succeeds or
 * retries on its own, so a failing step never repeats the others' mail.
 * Owners are suggested from the Issue's latest Event as processing stored
 * it, which carries the frames, URL and tags ownership reads.
 */

import { deliverDigest } from '../../application/alerts/deliver-digest.js';
import { evaluateIssueAlerts } from '../../application/alerts/evaluate-issue-alerts.js';
import { notifyFollowers } from '../../application/alerts/notify-followers.js';
import { suggestOwners } from '../../application/issues/suggest-owners.js';
import { notifyReporters } from '../../application/reports/notify-reporters.js';
import { pushIssueChange } from '../../application/tracker/push-issue-change.js';
import { keepDigest, nextAlarmAt, storedDigest } from '../../adapters/do/digest.js';
import { sendEffectMessages, type EffectMessage } from '../../adapters/queues/queue-effect-queue.js';
import { eventBlobKey } from '../../domain/event/event-summary.js';
import type { IssueId, ProjectId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { storedOwnershipFacts, type OwnedEventSummary } from '../../domain/ownership/facts.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { DigestRuntime, NotifierRuntime } from './deps.js';

export const NOTIFIER_STEPS = ['notifyReporters', 'notifyFollowers', 'evaluateIssueAlerts', 'pushIssueChange', 'suggestOwners'] as const;

export type NotifierStep = (typeof NOTIFIER_STEPS)[number];

/** One step's message: the Issue Change, its Project, and the step it stands for. */
export type StepMessage = { readonly projectId: ProjectId; readonly change: IssueChange; readonly step: NotifierStep };

const NEW_ISSUE = 'unresolved/new';

// --- predicates ---

export function isNotifierStep(step: string): step is NotifierStep {
  return (NOTIFIER_STEPS as readonly string[]).includes(step);
}

/** The change that opened the Issue. */
export function isNewIssue(change: IssueChange): boolean {
  return change.kind === 'status' && change.from === null && change.to === NEW_ISSUE;
}

// --- helpers ---

/** The steps an Issue Change starts; owners are suggested only for a new Issue. */
export function stepsFor(change: IssueChange): NotifierStep[] {
  return NOTIFIER_STEPS.filter((step) => step !== 'suggestOwners' || isNewIssue(change));
}

export function stepMessagesOf(message: EffectMessage): StepMessage[] {
  return stepsFor(message.change).map((step) => ({ projectId: message.projectId, change: message.change, step }));
}

// --- flow: owner suggestions ---

async function ownedEventOf(
  scope: { projectId: ProjectId; issueId: IssueId },
  deps: { projects: ProjectClient; blobs: BlobStore },
): Promise<OwnedEventSummary | null> {
  const summary = await deps.projects.latestEventOf(scope.projectId, scope.issueId);
  if (summary === null) return null;
  const stored = await deps.blobs.get(eventBlobKey({ projectId: scope.projectId, eventId: summary.eventId }));
  const ownership = stored === null ? null : storedOwnershipFacts(stored);
  return ownership === null ? null : { ...summary, ownership };
}

async function suggestOwnersStep(message: StepMessage, runtime: NotifierRuntime): Promise<void> {
  const { projectId, change } = message;
  const event = await ownedEventOf({ projectId, issueId: change.issueId }, { projects: runtime.owners.projects, blobs: runtime.blobs });
  if (event !== null) await suggestOwners(projectId, change.issueId, event, runtime.owners);
}

// --- flow: one step ---

export async function runStep(message: StepMessage, runtime: NotifierRuntime): Promise<void> {
  const { projectId, change } = message;
  switch (message.step) {
    case 'notifyReporters':
      await notifyReporters(projectId, change, runtime.reporters);
      return;
    case 'notifyFollowers':
      await notifyFollowers(projectId, change, runtime.followers);
      return;
    case 'evaluateIssueAlerts':
      await evaluateIssueAlerts(projectId, { issueId: change.issueId, change, event: null }, runtime.alerts);
      return;
    case 'pushIssueChange':
      await pushIssueChange(projectId, change, runtime.tracker);
      return;
    case 'suggestOwners':
      await suggestOwnersStep(message, runtime);
      return;
  }
}

// --- flow: one message ---

/** A change fans out into its step messages; a step message runs its step. A step the notifier does not know throws. */
export async function handleEffectMessage(message: EffectMessage, runtime: NotifierRuntime): Promise<void> {
  const { step } = message;
  if (step === undefined) return sendEffectMessages(runtime.effects, stepMessagesOf(message));
  if (!isNotifierStep(step)) throw new Error(`notifier: unknown step ${step}`);
  await runStep({ projectId: message.projectId, change: message.change, step }, runtime);
}

// --- flow: DigestDO's alarm ---

/** Hands the held Digest to deliverDigest and keeps what it returns, with the alarm for whatever is left. */
export async function deliverHeldDigest(storage: DurableObjectStorage, runtime: DigestRuntime): Promise<void> {
  const digest = await storedDigest(storage);
  if (digest === null) return;
  const kept = await deliverDigest(digest, runtime);
  await keepDigest(storage, {
    digest: kept,
    alarmAt: nextAlarmAt({ digest: kept, policy: runtime.policy, now: runtime.clock.now(), retryMs: runtime.retryMs }),
  });
}
