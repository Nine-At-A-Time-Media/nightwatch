// ProjectClient contract: the Durable Object client over ProjectDO and the
// in-process fake agree on a representative subset -- assigning Events by
// Fingerprint, filing a Report issue, a Release first seen, External Links
// and filings -- and keep each Project apart. ProjectDO's own promises
// follow: its alarm sweeps and schedules the next sweep, retention sets a
// sweep when none is set, an object answers
// for one Project only, and no step past the RPC surface is reachable.
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import { SqliteIssueStore } from '../../../src/adapters/do-sqlite/sqlite-issue-store.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import type { IssueState } from '../../../src/domain/issue/state.js';
import type { RetentionPolicy } from '../../../src/domain/retention/retention.js';
import type { Report } from '../../../src/domain/report/report.js';
import type { ExternalLink } from '../../../src/domain/tracker/external-link.js';
import type { ProjectClient } from '../../../src/ports/project-client.js';
import { FakeEffectQueue } from '../../_fakes/effect-queue.js';
import { FakeClock } from '../../_fakes/fake-clock.js';
import { FakeIds } from '../../_fakes/fake-ids.js';
import { FakeProjectClient } from '../../_fakes/fake-project-client.js';
import { policies } from '../../unit/domain/issue/fixtures.js';

const DAY = 86_400_000;
const NOW = Date.now();

// --- values ---

const RETENTION: RetentionPolicy = {
  raw: 30 * DAY,
  event: 90 * DAY,
  attachment: 30 * DAY,
  report: 365 * DAY,
  outcome: 90 * DAY,
  history: 365 * DAY,
};

function summary(eventId: string, at = NOW): EventSummary {
  return {
    eventId,
    at,
    release: null,
    environment: 'production',
    level: 'error',
    userKey: 'user-1',
    title: 'TypeError',
    culprit: null,
  };
}

function report(projectId: string, id: string, issueId: string): Report {
  return {
    id,
    projectId,
    issueId,
    reporter: { email: 'ada@example.test' },
    message: 'checkout hangs',
    attachments: [],
    associatedEventId: null,
    filedAt: NOW,
    spam: false,
    unsubscribed: false,
    referenceHash: `hash-${id}`,
  };
}

function link(issueId: string): ExternalLink {
  return { issueId, repository: 'acme/shop', number: 12, state: 'linked', lastKnown: { state: 'open' }, expected: null, refusals: 0 };
}

function issueIdOf(assignment: object): string {
  if (!('issueId' in assignment) || typeof assignment.issueId !== 'string') throw new Error('not assigned to an issue');
  return assignment.issueId;
}

/** The message a call over RPC failed with; awaited inside try so the RPC promise is consumed once. */
async function failureOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return 'no failure';
  } catch (error) {
    return String(error);
  }
}

const project = () => `project-${crypto.randomUUID()}`;

// --- subjects ---

describe.each<{ name: string; make: () => ProjectClient }>([
  {
    name: 'FakeProjectClient',
    make: () =>
      new FakeProjectClient({
        clock: new FakeClock(NOW),
        ids: new FakeIds('issue'),
        effects: new FakeEffectQueue(),
        policies,
        dedupWindow: DAY,
      }),
  },
  { name: 'DurableProjectClient', make: () => new DurableProjectClient({ namespace: env.PROJECT }) },
])('ProjectClient contract -- $name', ({ make }) => {
  it('Same crash, same issue -- Given an Issue holding a Fingerprint, When another Event of it is assigned, Then it joins that Issue', async () => {
    const client = make();
    const projectId = project();
    const first = await client.assignEvent(projectId, summary('event-1'), ['fp-1']);
    const second = await client.assignEvent(projectId, summary('event-2'), ['fp-1']);
    expect(issueIdOf(second)).toBe(issueIdOf(first));
    expect(second.duplicate).toBe(false);
    expect((await client.getIssue(projectId, issueIdOf(first)))?.count).toBe(2);
    expect(await client.fingerprintsOf(projectId, issueIdOf(first))).toEqual(['fp-1']);
  });

  it('New crash, new issue -- Given an Issue holding one Fingerprint, When an Event of another is assigned, Then a new Issue opens', async () => {
    const client = make();
    const projectId = project();
    const first = await client.assignEvent(projectId, summary('event-1'), ['fp-1']);
    const second = await client.assignEvent(projectId, summary('event-2'), ['fp-2']);
    expect(issueIdOf(second)).not.toBe(issueIdOf(first));
    expect(second.changes.length).toBeGreaterThan(0);
    expect(await client.countEvents(projectId, { issueId: issueIdOf(second), since: 0 })).toBe(1);
  });

  it('an Event Id assigned again is a duplicate of the first assignment', async () => {
    const client = make();
    const projectId = project();
    const first = await client.assignEvent(projectId, summary('event-1'), ['fp-1']);
    const again = await client.assignEvent(projectId, summary('event-1'), ['fp-1']);
    expect(again).toEqual({ issueId: issueIdOf(first), changes: [], duplicate: true });
  });

  it("one Project's Fingerprints never group another's Events", async () => {
    const client = make();
    const [a, b] = [project(), project()];
    const inA = await client.assignEvent(a, summary('event-1'), ['fp-1']);
    const inB = await client.assignEvent(b, summary('event-2'), ['fp-1']);
    expect(inB.changes.length).toBeGreaterThan(0);
    expect(await client.getIssue(b, issueIdOf(inA))).toBeNull();
  });

  it('filing a Report opens its Report issue, attaches the Report and shows it Received', async () => {
    const client = make();
    const projectId = project();
    const filed = report(projectId, 'report-1', 'report-issue-1');
    const changes = await client.openReportIssue(projectId, filed);
    expect(changes.length).toBeGreaterThan(0);
    expect(await client.reportsOn(projectId, 'report-issue-1')).toEqual([filed]);
    expect(await client.getReport(projectId, 'report-1')).toEqual(filed);
    expect((await client.statusChangesOf(projectId, 'report-1')).map((change) => change.status)).toEqual(['received']);
    expect((await client.getIssue(projectId, 'report-issue-1'))?.issueId).toBe('report-issue-1');
  });

  it('a Release seen is kept with when it was first seen', async () => {
    const client = make();
    const projectId = project();
    expect(await client.recordReleaseSeen(projectId, '1.2.0')).toEqual([]);
    await client.recordReleaseSeen(projectId, '1.3.0');
    expect([...(await client.releasesSeen(projectId)).keys()]).toEqual(['1.2.0', '1.3.0']);
  });

  it('keeps an External Link and a filing as recorded', async () => {
    const client = make();
    const projectId = project();
    expect(await client.externalLinkOf(projectId, 'issue-1')).toBeNull();
    await client.recordExternalLink(projectId, link('issue-1'));
    expect(await client.externalLinkOf(projectId, 'issue-1')).toEqual(link('issue-1'));
    expect(await client.recallFiling(projectId, 'key-1')).toBeNull();
    await client.recordFiling(projectId, 'key-1', { reportId: 'report-1', noticeSent: true });
    expect(await client.recallFiling(projectId, 'key-1')).toEqual({ reportId: 'report-1', noticeSent: true });
  });

  it('assigns an Issue, making an assigned Member follow it, and moves a Report onto another Issue', async () => {
    const client = make();
    const projectId = project();
    const member = { member: 'member-1' };
    const crash = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1']));
    const changes = await client.assignIssue(projectId, crash, member, member);
    expect(Array.isArray(changes) && changes.map((change) => change.kind)).toEqual(['assignee', 'for_review']);
    expect(await client.assigneeOf(projectId, crash)).toEqual(member);
    expect(await client.participationsOf(projectId, crash)).toEqual([{ member: 'member-1', reason: 'assigned' }]);
    expect(await client.assignIssue(projectId, 'issue-404', member, 'system')).toEqual({ refusal: 'issue_not_found' });

    await client.openReportIssue(projectId, report(projectId, 'report-1', 'report-issue-1'));
    const moved = await client.moveReport(projectId, { reportId: 'report-1', to: crash, actor: member });
    expect(moved).toMatchObject({ id: 'report-1', issueId: crash });
    expect((await client.reportsOn(projectId, crash)).map((held) => held.id)).toEqual(['report-1']);
  });

  it('Retention expiry -- Given an event older than Event Retention, When retention runs and anyone asks for it, Then it is not found', async () => {
    const client = make();
    const projectId = project();
    const old = issueIdOf(await client.assignEvent(projectId, summary('event-old', NOW - 100 * DAY), ['fp-old']));
    const kept = issueIdOf(await client.assignEvent(projectId, summary('event-new'), ['fp-new']));
    expect(await client.enforceRetention(projectId, RETENTION)).toEqual({ events: 1, issues: 1, reports: 0 });
    expect(await client.getIssue(projectId, old)).toBeNull();
    expect(await client.countEvents(projectId, { issueId: kept, since: 0 })).toBe(1);
  });

  // --- task-038: triage, merge, split, discard ---

  it('triages an Issue: resolving it records the change, and an illegal transition is refused', async () => {
    const client = make();
    const projectId = project();
    const member = { member: 'member-1' };
    const crash = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1']));
    const changes = await client.triageIssue(projectId, crash, { kind: 'resolve', resolution: { kind: 'plain' } }, member);
    expect(Array.isArray(changes) && changes.map((change) => change.kind)).toEqual(['status', 'resolution', 'for_review']);
    expect(await client.getIssue(projectId, crash)).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' } });
    expect(await client.triageIssue(projectId, crash, { kind: 'unarchive' }, member)).toEqual({ refusal: 'transition_not_allowed' });
    expect(await client.triageIssue(projectId, 'issue-404', { kind: 'mark_reviewed' }, member)).toEqual({ refusal: 'issue_not_found' });
  });

  it('Merge -- Given two issues, When a member merges them, Then one issue holds all Fingerprints and events', async () => {
    const client = make();
    const projectId = project();
    const member = { member: 'member-1' };
    const target = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1']));
    const source = issueIdOf(await client.assignEvent(projectId, summary('event-2'), ['fp-2']));
    const changes = await client.mergeIssues(projectId, { target, sources: [source], actor: member });
    expect(Array.isArray(changes)).toBe(true);
    expect(await client.getIssue(projectId, source)).toBeNull();
    expect((await client.getIssue(projectId, target))?.count).toBe(2);
    expect([...(await client.fingerprintsOf(projectId, target))].sort()).toEqual(['fp-1', 'fp-2']);
    expect(await client.mergeIssues(projectId, { target, sources: ['issue-404'], actor: member })).toEqual({ refusal: 'issue_not_found' });
  });

  it('Split -- Given an issue with two Fingerprints, When a member splits one off, Then a new issue holds its events', async () => {
    const client = make();
    const projectId = project();
    const member = { member: 'member-1' };
    const issue = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1', 'fp-2']));
    await client.assignEvent(projectId, summary('event-2'), ['fp-2']);
    const changes = await client.splitIssue(projectId, { issueId: issue, fingerprints: ['fp-2'], actor: member });
    expect(Array.isArray(changes)).toBe(true);
    expect(await client.fingerprintsOf(projectId, issue)).toEqual(['fp-1']);
    const next = issueIdOf(await client.assignEvent(projectId, summary('event-3'), ['fp-2']));
    expect(next).not.toBe(issue);
    expect(await client.fingerprintsOf(projectId, next)).toEqual(['fp-2']);
    expect(await client.shortIdOf(projectId, next)).not.toBe(await client.shortIdOf(projectId, issue));
  });

  it('Discard -- Given an issue, When a member discards it, Then it is gone and later events with its Fingerprints are dropped', async () => {
    const client = make();
    const projectId = project();
    const member = { member: 'member-1' };
    const issue = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1']));
    const changes = await client.discardIssue(projectId, issue, member);
    expect(Array.isArray(changes) && changes.map((change) => change.to)).toEqual(['deleting']);
    expect(await client.getIssue(projectId, issue)).toBeNull();
    expect(await client.assignEvent(projectId, summary('event-2'), ['fp-1'])).toEqual({ tombstone: issue, changes: [], duplicate: false });
    expect(await client.discardIssue(projectId, issue, member)).toEqual({ refusal: 'issue_not_found' });
  });

  it("an Issue's Short Id counter is kept; none for an Issue the Project does not hold", async () => {
    const client = make();
    const projectId = project();
    const first = issueIdOf(await client.assignEvent(projectId, summary('event-1'), ['fp-1']));
    expect(typeof (await client.shortIdOf(projectId, first))).toBe('number');
    expect(await client.shortIdOf(projectId, 'issue-404')).toBeNull();
  });
});

describe('ProjectDO', () => {
  const client = () => new DurableProjectClient({ namespace: env.PROJECT });
  const stubOf = (projectId: string) => env.PROJECT.get(env.PROJECT.idFromName(projectId));

  it('New becomes ongoing -- Given a New issue older than the New Issue Age, When the sweep alarm runs, Then it is Ongoing and the next sweep is set', async () => {
    const projectId = project();
    const assignment = await client().assignEvent(projectId, summary('event-1'), ['fp-1']);
    const issueId = issueIdOf(assignment);
    const old = NOW - 4 * DAY;
    await runInDurableObject(stubOf(projectId), async (_instance, state) => {
      const store = new SqliteIssueStore({ storage: state.storage, dedupWindow: DAY });
      const held = (await store.getIssue(issueId)) as IssueState;
      await store.putIssue({ ...held, firstSeen: old, substatusSince: old });
    });
    expect(await runDurableObjectAlarm(stubOf(projectId))).toBe(true);
    expect(await client().getIssue(projectId, issueId)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
    const next = await runInDurableObject(stubOf(projectId), (_instance, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(NOW);
  });

  it('retention sets the sweep alarm of a Project that has none', async () => {
    const projectId = project();
    await client().getIssue(projectId, 'issue-1');
    await runInDurableObject(stubOf(projectId), (_instance, state) => state.storage.deleteAlarm());
    await client().enforceRetention(projectId, RETENTION);
    const next = await runInDurableObject(stubOf(projectId), (_instance, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(NOW);
  });

  it('an object answers for the Project it was first named for, and refuses another', async () => {
    const projectId = project();
    await client().getIssue(projectId, 'issue-1');
    expect(await failureOf(() => stubOf(projectId).getIssue(project(), 'issue-1'))).toMatch(/holds project/);
  });

  it('reaches no step past the RPC surface: a module function is not a method', async () => {
    const stub = stubOf(project()) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    expect(await failureOf(() => stub['assignEventStep']!('p', summary('event-1'), ['fp-1']))).toMatch(/does not implement/);
  });
});
