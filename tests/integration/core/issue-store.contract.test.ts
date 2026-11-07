// IssueStore contract: the ProjectDO SQLite adapter and the in-memory fake
// keep the same promises, method by method. Each case runs against a fresh
// store: the fake in this isolate, the SQLite adapter inside a fresh ProjectDO
// through runInDurableObject. Rules the port leaves implicit are pinned here
// too: the order lists come back in, what a second write under one key does.
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SqliteIssueStore } from '../../../src/adapters/do-sqlite/sqlite-issue-store.js';
import { assignEvent } from '../../../src/application/issues/assign-event.js';
import type { AlertFiring } from '../../../src/domain/alerts/alert-firing.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import type { Tombstone } from '../../../src/domain/issue/assignment.js';
import type { IssueChange, IssueState } from '../../../src/domain/issue/state.js';
import type { GroupedEvent } from '../../../src/domain/issue/tally.js';
import type { Report } from '../../../src/domain/report/report.js';
import type { MemberComment, ReporterComment } from '../../../src/domain/report/thread.js';
import type { ExternalLink } from '../../../src/domain/tracker/external-link.js';
import type { IssueStore } from '../../../src/ports/issue-store.js';
import { FakeClock } from '../../_fakes/fake-clock.js';
import { FakeIds } from '../../_fakes/fake-ids.js';
import { FakeIssueStore } from '../../_fakes/issue-store.js';
import { policies } from '../../unit/domain/issue/fixtures.js';

const HOUR = 3_600_000;
const DEDUP_WINDOW = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 1);

type Held = { store: IssueStore; history: () => Promise<readonly IssueChange[]> };
type Subject = { name: string; run: (test: (held: Held) => Promise<void>) => Promise<void> };

// --- values ---

function issue(issueId: string, overrides: Partial<IssueState> = {}): IssueState {
  return {
    issueId,
    status: 'unresolved',
    substatus: 'new',
    substatusSince: T0,
    firstSeen: T0,
    lastSeen: T0,
    count: 1,
    userCount: 0,
    priority: { level: 'medium', setByHand: false },
    forReviewSince: T0,
    ...overrides,
  } as IssueState;
}

function summary(eventId: string, at: number, userKey: string | null = null): EventSummary {
  return { eventId, at, release: null, environment: 'production', level: 'error', userKey, title: 'TypeError', culprit: null };
}

function event(eventId: string, at: number, fingerprints: string[], userKey: string | null = null): GroupedEvent {
  return { summary: summary(eventId, at, userKey), fingerprints };
}

function report(id: string, issueId: string, email: string): Report {
  return {
    id,
    projectId: 'project-1',
    issueId,
    reporter: { email },
    message: 'the button does nothing',
    attachments: [],
    associatedEventId: null,
    filedAt: T0,
    spam: false,
    unsubscribed: false,
    referenceHash: `hash-${id}`,
  };
}

function memberComment(id: string, at: number): MemberComment {
  return { id, author: { member: 'member-1' }, shared: true, text: `comment ${id}`, at };
}

function reporterComment(id: string, reportId: string, at: number): ReporterComment {
  return { id, author: { report: reportId }, shared: true, text: `reply ${id}`, at };
}

function tombstone(issueId: string, fingerprints: string[]): Tombstone {
  return { issueId, fingerprints, at: T0, actor: { member: 'member-1' } };
}

function firing(ruleId: string, issueId: string, at: number, status: 'pending' | 'delivered' = 'pending'): AlertFiring {
  return { ruleId, issueId, at, deliveries: [{ action: { kind: 'webhook', url: 'https://example.test/hook' }, status }] };
}

function change(issueId: string, at: number): IssueChange {
  return { issueId, kind: 'status', from: null, to: 'unresolved', actor: 'system', origin: 'nightwatch', at };
}

function link(issueId: string, number: number): ExternalLink {
  return {
    issueId,
    repository: 'acme/shop',
    number,
    state: 'linked',
    lastKnown: { state: 'open' },
    expected: null,
    refusals: 0,
  };
}

/** A promise the test settles by hand, to hold a transaction open without timers. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

// --- subjects ---

const fake: Subject = {
  name: 'FakeIssueStore',
  run: async (test) => {
    const store = new FakeIssueStore({ dedupWindow: DEDUP_WINDOW });
    await test({ store, history: async () => [...store.history] });
  },
};

const sqlite: Subject = {
  name: 'SqliteIssueStore',
  run: async (test) => {
    const stub = env.PROJECT.get(env.PROJECT.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new SqliteIssueStore({ storage: state.storage, dedupWindow: DEDUP_WINDOW });
      const history = async () =>
        state.storage.sql
          .exec<{ change: string }>('SELECT change FROM history ORDER BY seq')
          .toArray()
          .map((row) => JSON.parse(row.change) as IssueChange);
      await test({ store, history });
    });
  },
};

describe.each<Subject>([fake, sqlite])('IssueStore contract -- $name', ({ run }) => {
  describe('transact', () => {
    it('returns what its work returns, and rejects with what its work throws', () =>
      run(async ({ store }) => {
        expect(await store.transact(async () => 7)).toBe(7);
        await expect(store.transact(async () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
        expect(await store.transact(async () => 'after a failure')).toBe('after a failure');
      }));

    it('runs no other transaction until the one before it settles', () =>
      run(async ({ store }) => {
        const order: string[] = [];
        const held = gate();
        const first = store.transact(async () => {
          order.push('first starts');
          await held.opened;
          order.push('first ends');
        });
        const second = store.transact(async () => {
          order.push('second runs');
        });
        await Promise.resolve();
        held.open();
        await Promise.all([first, second]);
        expect(order).toEqual(['first starts', 'first ends', 'second runs']);
      }));

    it('Concurrent first events -- Given two Events of one new Fingerprint at once, When both are assigned, Then one Issue holds both', () =>
      run(async ({ store }) => {
        const deps = { issues: store, clock: new FakeClock(T0), ids: new FakeIds('issue'), policies };
        const [a, b] = await Promise.all([
          assignEvent(summary('event-a', T0), ['fp-1'], deps),
          assignEvent(summary('event-b', T0), ['fp-1'], deps),
        ]);
        expect('issueId' in a && 'issueId' in b && a.issueId === b.issueId).toBe(true);
        expect(await store.listIssues()).toHaveLength(1);
        expect((await store.eventsOf((await store.listIssues())[0]!.issueId)).map((held) => held.summary.eventId)).toEqual([
          'event-a',
          'event-b',
        ]);
      }));
  });

  describe('deduplication', () => {
    it('recalls an assignment within the dedup window, inclusive, and forgets it after', () =>
      run(async ({ store }) => {
        expect(await store.recallAssignment('event-1', T0)).toBeNull();
        await store.rememberAssignment('event-1', { issueId: 'issue-1' }, T0);
        expect(await store.recallAssignment('event-1', T0 + DEDUP_WINDOW)).toEqual({ issueId: 'issue-1' });
        expect(await store.recallAssignment('event-1', T0 + DEDUP_WINDOW + 1)).toBeNull();
      }));

    it('a later remembrance replaces the earlier, Tombstone targets included', () =>
      run(async ({ store }) => {
        await store.rememberAssignment('event-1', { issueId: 'issue-1' }, T0);
        await store.rememberAssignment('event-1', { tombstone: 'issue-2' }, T0 + HOUR);
        expect(await store.recallAssignment('event-1', T0 + HOUR)).toEqual({ tombstone: 'issue-2' });
      }));
  });

  describe('Fingerprints and Tombstones', () => {
    it('finds the Issue of the first given Fingerprint that has one; attaching never takes a held Fingerprint', () =>
      run(async ({ store }) => {
        await store.attachFingerprints('issue-1', ['fp-a', 'fp-b']);
        await store.attachFingerprints('issue-2', ['fp-b', 'fp-c']);
        expect(await store.findIssueByFingerprints(['fp-x', 'fp-c', 'fp-a'])).toBe('issue-2');
        expect(await store.findIssueByFingerprints(['fp-x'])).toBeNull();
        expect(await store.findIssueByFingerprints([])).toBeNull();
        expect(await store.fingerprintsOf('issue-1')).toEqual(['fp-a', 'fp-b']);
        expect(await store.fingerprintsOf('issue-2')).toEqual(['fp-c']);
      }));

    it('finds the first Tombstone holding any given Fingerprint', () =>
      run(async ({ store }) => {
        await store.putTombstone(tombstone('issue-1', ['fp-a']));
        await store.putTombstone(tombstone('issue-2', ['fp-b', 'fp-a']));
        expect(await store.findTombstone(['fp-b'])).toEqual(tombstone('issue-2', ['fp-b', 'fp-a']));
        expect(await store.findTombstone(['fp-a'])).toEqual(tombstone('issue-1', ['fp-a']));
        expect(await store.findTombstone(['fp-z'])).toBeNull();
      }));
  });

  describe('Issues and History', () => {
    it('Short Ids count up and are never reused; a Short Id names its Issue', () =>
      run(async ({ store }) => {
        expect(await store.assignShortId('issue-1')).toBe(1);
        expect(await store.assignShortId('issue-2')).toBe(2);
        await store.removeIssue('issue-1');
        expect(await store.assignShortId('issue-3')).toBe(3);
        expect(await store.shortIdOf('issue-2')).toBe(2);
        expect(await store.shortIdOf('issue-9')).toBeNull();
        expect(await store.issueOfShortId(3)).toBe('issue-3');
        expect(await store.issueOfShortId(42)).toBeNull();
      }));

    it('keeps the latest state of each Issue, listed in the order first put', () =>
      run(async ({ store }) => {
        await store.putIssue(issue('issue-1'));
        await store.putIssue(issue('issue-2'));
        await store.putIssue(issue('issue-1', { count: 5 }));
        expect(await store.getIssue('issue-1')).toEqual(issue('issue-1', { count: 5 }));
        expect(await store.getIssue('issue-9')).toBeNull();
        expect((await store.listIssues()).map((state) => state.issueId)).toEqual(['issue-1', 'issue-2']);
      }));

    it('removing an Issue removes its Fingerprints, Events, Comments and Forecast, and leaves other Issues alone', () =>
      run(async ({ store }) => {
        for (const id of ['issue-1', 'issue-2']) {
          await store.putIssue(issue(id));
          await store.attachFingerprints(id, [`fp-${id}`]);
          await store.recordEvent(id, event(`event-${id}`, T0, [`fp-${id}`]));
          await store.appendComment(id, memberComment(`comment-${id}`, T0));
          await store.putForecast(id, { ceiling: 3, computedAt: T0 });
        }
        await store.removeIssue('issue-1');
        expect(await store.getIssue('issue-1')).toBeNull();
        expect(await store.findIssueByFingerprints(['fp-issue-1'])).toBeNull();
        expect(await store.eventsOf('issue-1')).toEqual([]);
        expect(await store.commentsOn('issue-1')).toEqual([]);
        expect(await store.getForecast('issue-1')).toBeNull();
        expect(await store.listIssues()).toEqual([issue('issue-2')]);
        expect(await store.eventsOf('issue-2')).toHaveLength(1);
        expect(await store.commentsOn('issue-2')).toHaveLength(1);
        expect(await store.getForecast('issue-2')).toEqual({ ceiling: 3, computedAt: T0 });
      }));

    it('appends History in order', () =>
      run(async ({ store, history }) => {
        await store.appendHistory([change('issue-1', T0)]);
        await store.appendHistory([change('issue-2', T0 + 1), change('issue-1', T0 + 2)]);
        expect(await history()).toEqual([change('issue-1', T0), change('issue-2', T0 + 1), change('issue-1', T0 + 2)]);
      }));
  });

  describe('Events and counts', () => {
    it('lists an Issue’s Events in the order recorded; recording one Event Id again replaces it in place', () =>
      run(async ({ store }) => {
        await store.recordEvent('issue-1', event('event-1', T0, ['fp-a']));
        await store.recordEvent('issue-1', event('event-2', T0 + 1, ['fp-a']));
        await store.recordEvent('issue-1', event('event-1', T0 + 2, ['fp-a'], 'user-1'));
        expect(await store.eventsOf('issue-1')).toEqual([event('event-1', T0 + 2, ['fp-a'], 'user-1'), event('event-2', T0 + 1, ['fp-a'])]);
        expect(await store.eventsOf('issue-2')).toEqual([]);
      }));

    it('counts Events and distinct named users at or after a time, and knows which users an Issue has seen', () =>
      run(async ({ store }) => {
        await store.recordEvent('issue-1', event('event-1', T0, ['fp'], 'user-1'));
        await store.recordEvent('issue-1', event('event-2', T0 + 10, ['fp'], 'user-1'));
        await store.recordEvent('issue-1', event('event-3', T0 + 20, ['fp'], 'user-2'));
        await store.recordEvent('issue-1', event('event-4', T0 + 30, ['fp'], null));
        await store.recordEvent('issue-2', event('event-5', T0 + 30, ['fp-2'], 'user-3'));
        expect(await store.countEvents({ issueId: 'issue-1', since: T0 + 10 })).toBe(3);
        expect(await store.countUsers({ issueId: 'issue-1', since: T0 })).toBe(2);
        expect(await store.countUsers({ issueId: 'issue-1', since: T0 + 20 })).toBe(1);
        expect(await store.hasUser({ issueId: 'issue-1', userKey: 'user-2' })).toBe(true);
        expect(await store.hasUser({ issueId: 'issue-1', userKey: 'user-3' })).toBe(false);
      }));

    it('counts an Issue’s Events per whole hour from `since`, oldest first, dropping a partial last hour', () =>
      run(async ({ store }) => {
        const since = T0 + 15 * 60_000;
        await store.recordEvent('issue-1', event('before', since - 1, ['fp']));
        await store.recordEvent('issue-1', event('first-hour', since, ['fp']));
        await store.recordEvent('issue-1', event('third-hour-a', since + 2 * HOUR, ['fp']));
        await store.recordEvent('issue-1', event('third-hour-b', since + 3 * HOUR - 1, ['fp']));
        await store.recordEvent('issue-1', event('partial', since + 3 * HOUR + 1, ['fp']));
        expect(await store.hourlyCounts({ issueId: 'issue-1', since, until: since + 3 * HOUR + 30 * 60_000 })).toEqual([1, 0, 2]);
        expect(await store.hourlyCounts({ issueId: 'issue-1', since, until: since })).toEqual([]);
      }));

    it('the Project’s normal hourly rate is a finite number, never negative', () =>
      run(async ({ store }) => {
        await store.recordEvent('issue-1', event('event-1', T0, ['fp']));
        const rate = await store.projectNormalRate();
        expect(Number.isFinite(rate) && rate >= 0).toBe(true);
      }));

    it('keeps one Forecast per Issue, the latest put', () =>
      run(async ({ store }) => {
        expect(await store.getForecast('issue-1')).toBeNull();
        await store.putForecast('issue-1', { ceiling: 4, computedAt: T0 });
        await store.putForecast('issue-1', { ceiling: 9.5, computedAt: T0 + HOUR });
        expect(await store.getForecast('issue-1')).toEqual({ ceiling: 9.5, computedAt: T0 + HOUR });
      }));
  });

  describe('merge and split moves', () => {
    it('reassigning an Issue moves its Fingerprints, Events, Reports and Comments, and nothing of another Issue', () =>
      run(async ({ store }) => {
        await store.attachFingerprints('source', ['fp-s']);
        await store.attachFingerprints('target', ['fp-t']);
        await store.attachFingerprints('other', ['fp-o']);
        await store.recordEvent('target', event('event-t', T0, ['fp-t']));
        await store.recordEvent('source', event('event-s', T0 + 1, ['fp-s']));
        await store.recordEvent('other', event('event-o', T0 + 2, ['fp-o']));
        await store.putReport(report('report-1', 'source', 'ada@example.test'));
        await store.appendComment('target', memberComment('comment-t', T0));
        await store.appendComment('source', memberComment('comment-s', T0 + 1));
        await store.reassignIssue({ from: 'source', to: 'target' });
        expect(await store.fingerprintsOf('target')).toEqual(expect.arrayContaining(['fp-s', 'fp-t']));
        expect(await store.fingerprintsOf('source')).toEqual([]);
        expect((await store.eventsOf('target')).map((held) => held.summary.eventId)).toEqual(['event-t', 'event-s']);
        expect(await store.reportsOn('target')).toEqual([report('report-1', 'target', 'ada@example.test')]);
        expect(await store.getReport('report-1')).toEqual(report('report-1', 'target', 'ada@example.test'));
        expect((await store.commentsOn('target')).map((comment) => comment.id)).toEqual(['comment-t', 'comment-s']);
        expect(await store.fingerprintsOf('other')).toEqual(['fp-o']);
        expect(await store.eventsOf('other')).toHaveLength(1);
      }));

    it('moving Fingerprints moves those the source holds and the Events grouped by any of them', () =>
      run(async ({ store }) => {
        await store.attachFingerprints('source', ['fp-a', 'fp-b']);
        await store.attachFingerprints('elsewhere', ['fp-c']);
        await store.recordEvent('source', event('event-a', T0, ['fp-a']));
        await store.recordEvent('source', event('event-b', T0 + 1, ['fp-b']));
        await store.recordEvent('source', event('event-ab', T0 + 2, ['fp-b', 'fp-a']));
        await store.moveFingerprints({ from: 'source', to: 'split', fingerprints: ['fp-a', 'fp-c'] });
        expect(await store.fingerprintsOf('split')).toEqual(['fp-a']);
        expect(await store.fingerprintsOf('source')).toEqual(['fp-b']);
        expect(await store.fingerprintsOf('elsewhere')).toEqual(['fp-c']);
        expect((await store.eventsOf('split')).map((held) => held.summary.eventId)).toEqual(['event-a', 'event-ab']);
        expect((await store.eventsOf('source')).map((held) => held.summary.eventId)).toEqual(['event-b']);
      }));
  });

  describe('Releases', () => {
    it('keeps the time each Release was first seen; a later sighting changes nothing', () =>
      run(async ({ store }) => {
        await store.recordReleaseFirstSeen('1.0.0', T0);
        await store.recordReleaseFirstSeen('1.1.0', T0 + HOUR);
        await store.recordReleaseFirstSeen('1.0.0', T0 + 2 * HOUR);
        expect([...(await store.releaseFirstSeen())]).toEqual([
          ['1.0.0', T0],
          ['1.1.0', T0 + HOUR],
        ]);
      }));
  });

  describe('Reports, Comments and the Report Status shown', () => {
    it('keeps Reports by id, lists them by Issue and by Reporter address without regard to case', () =>
      run(async ({ store }) => {
        await store.putReport(report('report-1', 'issue-1', 'Ada@Example.test'));
        await store.putReport(report('report-2', 'issue-2', 'ada@example.TEST'));
        await store.putReport(report('report-3', 'issue-1', 'bob@example.test'));
        await store.putReport({ ...report('report-1', 'issue-1', 'Ada@Example.test'), spam: true });
        expect(await store.getReport('report-1')).toEqual({ ...report('report-1', 'issue-1', 'Ada@Example.test'), spam: true });
        expect(await store.getReport('report-9')).toBeNull();
        expect((await store.reportsOn('issue-1')).map((held) => held.id)).toEqual(['report-1', 'report-3']);
        expect((await store.reportsBy({ email: 'ADA@example.test' })).map((held) => held.id)).toEqual(['report-1', 'report-2']);
      }));

    it('lists an Issue’s Comments oldest first, and the Report Status changes shown, oldest first', () =>
      run(async ({ store }) => {
        await store.appendComment('issue-1', memberComment('comment-1', T0));
        await store.appendComment('issue-1', reporterComment('comment-2', 'report-1', T0 + 1));
        await store.appendComment('issue-2', memberComment('comment-3', T0 + 2));
        expect(await store.commentsOn('issue-1')).toEqual([
          memberComment('comment-1', T0),
          reporterComment('comment-2', 'report-1', T0 + 1),
        ]);
        expect(await store.statusChangesOf('report-1')).toEqual([]);
        await store.recordStatusChange('report-1', { status: 'received', at: T0 });
        await store.recordStatusChange('report-1', { status: 'fixed', at: T0 + HOUR });
        expect(await store.statusChangesOf('report-1')).toEqual([
          { status: 'received', at: T0 },
          { status: 'fixed', at: T0 + HOUR },
        ]);
      }));

    it('removing a Report removes its shown statuses and the replies written on it, and no other Comment', () =>
      run(async ({ store }) => {
        await store.putReport(report('report-1', 'issue-1', 'ada@example.test'));
        await store.putReport(report('report-2', 'issue-1', 'bob@example.test'));
        await store.recordStatusChange('report-1', { status: 'received', at: T0 });
        await store.appendComment('issue-1', reporterComment('reply-1', 'report-1', T0));
        await store.appendComment('issue-1', reporterComment('reply-2', 'report-2', T0 + 1));
        await store.appendComment('issue-1', memberComment('comment-1', T0 + 2));
        await store.removeReport('report-1');
        expect(await store.getReport('report-1')).toBeNull();
        expect(await store.statusChangesOf('report-1')).toEqual([]);
        expect((await store.commentsOn('issue-1')).map((comment) => comment.id)).toEqual(['reply-2', 'comment-1']);
        expect((await store.reportsOn('issue-1')).map((held) => held.id)).toEqual(['report-2']);
      }));
  });

  describe('Sessions', () => {
    it('sums Sessions per status over every minute of one release and environment', () =>
      run(async ({ store }) => {
        await store.addSessions({ release: '1.0', environment: 'production', status: 'ok', minute: T0 }, 2);
        await store.addSessions({ release: '1.0', environment: 'production', status: 'ok', minute: T0 + 60_000 }, 3);
        await store.addSessions({ release: '1.0', environment: 'production', status: 'ok', minute: T0 }, 1);
        await store.addSessions({ release: '1.0', environment: 'production', status: 'crashed', minute: T0 }, 1);
        await store.addSessions({ release: '1.0', environment: 'staging', status: 'ok', minute: T0 }, 7);
        await store.addSessions({ release: '2.0', environment: 'production', status: 'ok', minute: T0 }, 7);
        expect(await store.sessionCounts({ release: '1.0', environment: 'production' })).toEqual({
          ok: 6,
          exited: 0,
          errored: 0,
          crashed: 1,
          abnormal: 0,
        });
        expect(await store.sessionCounts({ release: '9.9', environment: 'production' })).toEqual({
          ok: 0,
          exited: 0,
          errored: 0,
          crashed: 0,
          abnormal: 0,
        });
      }));

    it('counts each user once per release and environment; once crashed, a user stays crashed', () =>
      run(async ({ store }) => {
        const scope = { release: '1.0', environment: 'production' };
        await store.markSessionUser({ ...scope, userKey: 'user-1', crashed: true });
        await store.markSessionUser({ ...scope, userKey: 'user-1', crashed: false });
        await store.markSessionUser({ ...scope, userKey: 'user-2', crashed: false });
        await store.markSessionUser({ release: '1.0', environment: 'staging', userKey: 'user-3', crashed: true });
        expect(await store.sessionUsers(scope)).toEqual({ users: 2, crashedUsers: 1 });
        expect(await store.sessionUsers({ release: '2.0', environment: 'production' })).toEqual({ users: 0, crashedUsers: 0 });
      }));
  });

  describe('Assignee, Alert Firings and participations', () => {
    it('an Issue nobody assigned has no Assignee', () =>
      run(async ({ store }) => {
        expect(await store.assigneeOf('issue-1')).toBeNull();
      }));

    it('the last firing is the latest by time; a firing at the same rule, Issue and time replaces the kept one in place', () =>
      run(async ({ store }) => {
        expect(await store.lastFiring({ ruleId: 'rule-1', issueId: 'issue-1' })).toBeNull();
        await store.recordFiring(firing('rule-1', 'issue-1', T0 + HOUR));
        await store.recordFiring(firing('rule-1', 'issue-1', T0));
        await store.recordFiring(firing('rule-1', 'issue-2', T0 + 2 * HOUR));
        await store.recordFiring(firing('rule-2', 'issue-1', T0 + 3 * HOUR));
        await store.recordFiring(firing('rule-1', 'issue-1', T0 + HOUR, 'delivered'));
        expect(await store.lastFiring({ ruleId: 'rule-1', issueId: 'issue-1' })).toEqual(
          firing('rule-1', 'issue-1', T0 + HOUR, 'delivered'),
        );
        expect(await store.firingsOf('rule-1')).toEqual([
          firing('rule-1', 'issue-1', T0 + HOUR, 'delivered'),
          firing('rule-1', 'issue-1', T0),
          firing('rule-1', 'issue-2', T0 + 2 * HOUR),
        ]);
      }));

    it('lists each participation added to an Issue, in the order added', () =>
      run(async ({ store }) => {
        await store.addParticipation('issue-1', { member: 'member-1', reason: 'commented' });
        await store.addParticipation('issue-2', { member: 'member-2', reason: 'assigned' });
        await store.addParticipation('issue-1', { member: 'member-1', reason: 'mentioned' });
        expect(await store.participationsOf('issue-1')).toEqual([
          { member: 'member-1', reason: 'commented' },
          { member: 'member-1', reason: 'mentioned' },
        ]);
      }));
  });

  describe('External Links', () => {
    it('keeps one External Link per Issue, the latest put', () =>
      run(async ({ store }) => {
        expect(await store.externalLinkOf('issue-1')).toBeNull();
        await store.putExternalLink(link('issue-1', 7));
        await store.putExternalLink({ ...link('issue-1', 7), state: 'broken', refusals: 3 });
        await store.putExternalLink(link('issue-2', 8));
        expect(await store.externalLinkOf('issue-1')).toEqual({ ...link('issue-1', 7), state: 'broken', refusals: 3 });
        expect(await store.externalLinkOf('issue-2')).toEqual(link('issue-2', 8));
      }));
  });

  describe('filings under a filing key', () => {
    it('recalls what was filed under a key; a later record under it replaces it', () =>
      run(async ({ store }) => {
        expect(await store.recallFiling('key-1')).toBeNull();
        await store.recordFiling('key-1', { reportId: 'report-1', noticeSent: false });
        await store.recordFiling('key-2', { reportId: 'report-2', noticeSent: false });
        await store.recordFiling('key-1', { reportId: 'report-1', noticeSent: true });
        expect(await store.recallFiling('key-1')).toEqual({ reportId: 'report-1', noticeSent: true });
        expect(await store.recallFiling('key-2')).toEqual({ reportId: 'report-2', noticeSent: false });
      }));
  });
});

describe('SqliteIssueStore', () => {
  it('rolls back the writes of a transaction whose work throws', () =>
    sqlite.run(async ({ store }) => {
      await expect(
        store.transact(async () => {
          await store.putIssue(issue('issue-1'));
          throw new Error('refused');
        }),
      ).rejects.toThrow('refused');
      expect(await store.getIssue('issue-1')).toBeNull();
    }));

  it('runs its migrations once: a second store over the same storage keeps what the first wrote', async () => {
    const stub = env.PROJECT.get(env.PROJECT.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      await new SqliteIssueStore({ storage: state.storage, dedupWindow: DEDUP_WINDOW }).putIssue(issue('issue-1'));
      const again = new SqliteIssueStore({ storage: state.storage, dedupWindow: DEDUP_WINDOW });
      expect(await again.getIssue('issue-1')).toEqual(issue('issue-1'));
    });
  });

  it('the normal hourly rate is the Project’s Events over the clock hours from its first Event to its last', () =>
    sqlite.run(async ({ store }) => {
      expect(await store.projectNormalRate()).toBe(0);
      await store.recordEvent('issue-1', event('event-1', T0, ['fp']));
      await store.recordEvent('issue-1', event('event-2', T0 + 10, ['fp']));
      await store.recordEvent('issue-2', event('event-3', T0 + 3 * HOUR + 5, ['fp-2']));
      await store.recordEvent('issue-2', event('event-4', T0 + 3 * HOUR + 6, ['fp-2']));
      expect(await store.projectNormalRate()).toBe(1);
    }));
});

describe.each<Subject>([fake, sqlite])('IssueStore retention contract -- $name', ({ run }) => {
  it('removes only Events before the cutoff, from every Issue, and names them', () =>
    run(async ({ store }) => {
      await store.recordEvent('issue-1', event('old-1', T0 - 2, ['fp-1']));
      await store.recordEvent('issue-2', event('old-2', T0 - 1, ['fp-2']));
      await store.recordEvent('issue-1', event('kept', T0, ['fp-1']));
      expect([...(await store.removeEventsBefore(T0))].sort()).toEqual(['old-1', 'old-2']);
      expect((await store.eventsOf('issue-1')).map((held) => held.summary.eventId)).toEqual(['kept']);
      expect(await store.eventsOf('issue-2')).toEqual([]);
      expect(await store.removeEventsBefore(T0)).toEqual([]);
    }));

  it('lists the Reports filed before the cutoff and forgets only their filing records', () =>
    run(async ({ store }) => {
      await store.putReport({ ...report('report-old', 'issue-1', 'ada@example.test'), filedAt: T0 - 1 });
      await store.putReport(report('report-new', 'issue-1', 'ada@example.test'));
      await store.recordFiling('key-old', { reportId: 'report-old', noticeSent: true });
      await store.recordFiling('key-new', { reportId: 'report-new', noticeSent: true });
      expect((await store.reportsFiledBefore(T0)).map((filed) => filed.id)).toEqual(['report-old']);
      await store.forgetFilingsOf(['report-old']);
      expect(await store.recallFiling('key-old')).toBeNull();
      expect(await store.recallFiling('key-new')).toEqual({ reportId: 'report-new', noticeSent: true });
    }));
});
