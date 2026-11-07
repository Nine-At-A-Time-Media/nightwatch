import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { deriveFingerprints } from '../../../../src/domain/grouping/derive.js';
import type { GroupingFrame, GroupingInput } from '../../../../src/domain/grouping/grouping-input.js';
import { gv1 } from '../../../../src/domain/grouping/grouping-version.js';
import { archive, resolve, setPriority } from '../../../../src/domain/issue/commands.js';
import { HOUR, MINUTE, T0, command, issueIdOf, stateOf, summary, world } from './world.js';

const member = { member: 'member-1' };
const CRASH_A = ['fp-a'];
const CRASH_B = ['fp-b'];

function deps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

// --- grouping builders ---

function frame(lineno: number): GroupingFrame {
  return { module: 'app.checkout', function: 'pay', inApp: true, lineno };
}

function crash(overrides: Partial<GroupingInput> = {}): GroupingInput {
  return {
    exceptions: [{ type: 'PaymentError', value: 'declined', frames: [frame(41)] }],
    stacktrace: null,
    message: null,
    platform: 'python',
    fingerprint: null,
    logger: null,
    level: 'error',
    tags: {},
    ...overrides,
  };
}

function fingerprintsOf(input: GroupingInput) {
  return [...deriveFingerprints(input, { version: gv1, fingerprintRules: [], stackTraceRules: [] })];
}

describe('assignEvent', () => {
  it('Same crash, same issue: Given an issue holds a Fingerprint, When another event with that Fingerprint arrives, Then it joins that issue and the count rises by one', async () => {
    const w = world();
    const first = await assignEvent(summary(T0), CRASH_A, deps(w));
    const second = await assignEvent(summary(T0 + MINUTE), CRASH_A, deps(w));
    expect(issueIdOf(second)).toBe(issueIdOf(first));
    expect(second.changes).toEqual([]);
    expect(await stateOf(w.issues, issueIdOf(first))).toMatchObject({ count: 2, lastSeen: T0 + MINUTE });
  });

  it("New crash, new issue: Given no issue holds an event's Fingerprints, When it is processed, Then a new issue is created with status New", async () => {
    const w = world();
    const a = await assignEvent(summary(T0, { userKey: 'u1' }), CRASH_A, deps(w));
    const b = await assignEvent(summary(T0), CRASH_B, deps(w));
    expect(issueIdOf(a)).not.toBe(issueIdOf(b));
    expect(await stateOf(w.issues, issueIdOf(a))).toMatchObject({ status: 'unresolved', substatus: 'new', count: 1, userCount: 1 });
    expect(a.changes.map((c) => c.to)).toEqual(['unresolved/new', 'in']);
    expect(w.issues.history).toEqual([...a.changes, ...b.changes]);
    expect([await w.issues.shortIdOf(issueIdOf(a)), await w.issues.shortIdOf(issueIdOf(b))]).toEqual([1, 2]);
  });

  it('an event joining by one Fingerprint attaches its others, so later events with only those join too', async () => {
    const w = world();
    const first = await assignEvent(summary(T0), ['app', 'system'], deps(w));
    await assignEvent(summary(T0), ['system', 'extra'], deps(w));
    const later = await assignEvent(summary(T0), ['extra'], deps(w));
    expect(issueIdOf(later)).toBe(issueIdOf(first));
    expect(await stateOf(w.issues, issueIdOf(first))).toMatchObject({ count: 3 });
  });

  it('Concurrent first events: Given two events with the same new Fingerprint, When they are processed at once, Then exactly one issue exists afterwards and holds both', async () => {
    const w = world();
    const [a, b] = await Promise.all([assignEvent(summary(T0), CRASH_A, deps(w)), assignEvent(summary(T0), CRASH_A, deps(w))]);
    expect(issueIdOf(a)).toBe(issueIdOf(b));
    expect(await w.issues.listIssues()).toHaveLength(1);
    expect(await stateOf(w.issues, issueIdOf(a))).toMatchObject({ count: 2 });
  });

  it('SDK fingerprint wins: Given an event carries an SDK fingerprint without the default token, When it is processed, Then grouping uses only that fingerprint', async () => {
    const w = world();
    const pinned = (type: string) =>
      fingerprintsOf(crash({ fingerprint: ['checkout-failure'], exceptions: [{ type, value: null, frames: [frame(1)] }] }));
    const first = await assignEvent(summary(T0), pinned('PaymentError'), deps(w));
    const second = await assignEvent(summary(T0), pinned('TimeoutError'), deps(w));
    const unpinned = await assignEvent(summary(T0), fingerprintsOf(crash()), deps(w));
    expect(issueIdOf(second)).toBe(issueIdOf(first));
    expect(issueIdOf(unpinned)).not.toBe(issueIdOf(first));
  });

  it('Default token extends: Given an SDK fingerprint with the default token and a value, When processed, Then the event groups apart from events with the default Fingerprint alone', async () => {
    const w = world();
    const plain = await assignEvent(summary(T0), fingerprintsOf(crash()), deps(w));
    const salted = await assignEvent(summary(T0), fingerprintsOf(crash({ fingerprint: ['{{ default }}', 'tenant-a'] })), deps(w));
    const saltedAgain = await assignEvent(summary(T0), fingerprintsOf(crash({ fingerprint: ['{{ default }}', 'tenant-a'] })), deps(w));
    expect(issueIdOf(salted)).not.toBe(issueIdOf(plain));
    expect(issueIdOf(saltedAgain)).toBe(issueIdOf(salted));
  });

  it('Volatile parts ignored: Given two events differing only in line numbers, When processed, Then they join the same issue', async () => {
    const w = world();
    const at41 = await assignEvent(summary(T0), fingerprintsOf(crash()), deps(w));
    const moved = crash({ exceptions: [{ type: 'PaymentError', value: 'declined', frames: [frame(97)] }] });
    const at97 = await assignEvent(summary(T0), fingerprintsOf(moved), deps(w));
    expect(issueIdOf(at97)).toBe(issueIdOf(at41));
  });

  it('Tombstoned events dropped: Given a Tombstone holds a Fingerprint, When an event with it arrives, Then it is dropped with a discarded Outcome', async () => {
    const w = world();
    await w.issues.putTombstone({ issueId: 'issue-gone', fingerprints: ['fp-x', ...CRASH_A], at: T0, actor: member });
    const assignment = await assignEvent(summary(T0), CRASH_A, deps(w));
    expect(assignment).toEqual({ tombstone: 'issue-gone', changes: [], duplicate: false });
    expect(await w.issues.listIssues()).toEqual([]);
  });

  it('an Event Id seen within the dedup window is a duplicate: same target, no count change', async () => {
    const w = world();
    const event = summary(T0);
    const first = await assignEvent(event, CRASH_A, deps(w));
    w.clock.advance(HOUR);
    const again = await assignEvent(event, CRASH_A, deps(w));
    expect(again).toEqual({ issueId: issueIdOf(first), changes: [], duplicate: true });
    expect(await stateOf(w.issues, issueIdOf(first))).toMatchObject({ count: 1 });
    expect(await w.issues.listIssues()).toHaveLength(1);
  });

  it('a tombstoned Event Id repeated within the dedup window is a duplicate of its Tombstone', async () => {
    const w = world();
    await w.issues.putTombstone({ issueId: 'issue-gone', fingerprints: CRASH_A, at: T0, actor: member });
    const event = summary(T0);
    await assignEvent(event, CRASH_A, deps(w));
    expect(await assignEvent(event, CRASH_A, deps(w))).toEqual({ tombstone: 'issue-gone', changes: [], duplicate: true });
  });

  it("Early escalation: Given a young issue that is frequent and well above its project's normal rate, When another event arrives, Then it becomes Escalating and its Priority rises", async () => {
    const w = world({ policies: { earlyEscalation: { youngAge: HOUR * 24, minimumCount: 3, rateMultiple: 2 } }, projectNormalRate: 1 });
    const first = await assignEvent(summary(T0, { level: 'warning' }), CRASH_A, deps(w));
    await assignEvent(summary(T0 + MINUTE, { level: 'warning' }), CRASH_A, deps(w));
    const third = await assignEvent(summary(T0 + 2 * MINUTE, { level: 'warning' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, issueIdOf(first))).toMatchObject({
      status: 'unresolved',
      substatus: 'escalating',
      priority: { level: 'high', setByHand: false },
    });
    expect(third.changes.map((c) => [c.kind, c.to])).toContainEqual(['priority', 'high']);
  });

  it("an issue whose rate is not well above its project's normal rate does not escalate early", async () => {
    const w = world({ policies: { earlyEscalation: { youngAge: HOUR * 24, minimumCount: 3, rateMultiple: 2 } }, projectNormalRate: 10 });
    const first = await assignEvent(summary(T0), CRASH_A, deps(w));
    await assignEvent(summary(T0 + MINUTE), CRASH_A, deps(w));
    await assignEvent(summary(T0 + 2 * MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, issueIdOf(first))).toMatchObject({ substatus: 'new' });
  });

  it('Archived until escalating: Given an issue archived until escalating, When its hourly rate exceeds its Forecast, Then it becomes Escalating and enters For Review', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => archive(s, { substatus: 'until_escalating' }, member, T0));
    await w.issues.putForecast(id, { ceiling: 2, computedAt: T0 });
    const hour = T0 + 5 * HOUR;
    await assignEvent(summary(hour), CRASH_A, deps(w));
    await assignEvent(summary(hour + MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived', forReviewSince: null });
    await assignEvent(summary(hour + 2 * MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'escalating', forReviewSince: hour + 2 * MINUTE });
  });

  it('Archived until condition: Given an issue archived until a count, user count or date, When the condition is met, Then it becomes Ongoing', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0), CRASH_A, deps(w)));
    const condition = { untilDate: null, count: 2, window: null, userCount: null, userWindow: null };
    await command(w.issues, id, (s) => archive(s, { substatus: 'until_condition', condition }, member, T0));
    await assignEvent(summary(T0 + MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived' });
    await assignEvent(summary(T0 + 2 * MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
  });

  it('an issue archived until users within a window unarchives when that many users are seen inside it', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0, { userKey: 'u0' }), CRASH_A, deps(w)));
    const condition = { untilDate: null, count: null, window: null, userCount: 2, userWindow: HOUR };
    await command(w.issues, id, (s) => archive(s, { substatus: 'until_condition', condition }, member, T0));
    await assignEvent(summary(T0 + 3 * HOUR, { userKey: 'u1' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived' });
    await assignEvent(summary(T0 + 3 * HOUR + MINUTE, { userKey: 'u2' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing', userCount: 3 });
  });

  it('Archived forever stays: Given an issue archived forever, When events arrive, Then it stays archived and counts rise', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => archive(s, { substatus: 'forever', spam: false }, member, T0));
    for (let i = 1; i <= 5; i++) await assignEvent(summary(T0 + i * MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'archived', substatus: 'forever', count: 6 });
  });

  it('Regression in newer release: Given an issue resolved in release R, When an event from a release newer than R arrives, Then it becomes Regressed', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0, { release: '1.2.0' }), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => resolve(s, { kind: 'in_release', release: '1.2.0' }, member, T0));
    const assignment = await assignEvent(summary(T0 + HOUR, { release: '1.3.0' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'regressed' });
    expect(assignment.changes.map((c) => c.to)).toContain('unresolved/regressed');
  });

  it('No regression from older release: Given an issue resolved in release R, When an event from a release older than R arrives, Then it stays resolved', async () => {
    const w = world();
    const id = issueIdOf(await assignEvent(summary(T0, { release: '1.2.0' }), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => resolve(s, { kind: 'in_release', release: '1.2.0' }, member, T0));
    const assignment = await assignEvent(summary(T0 + HOUR, { release: '1.1.0' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved', count: 2 });
    expect(assignment.changes).toEqual([]);
  });

  it('a non-semantic release orders by the first sight the store recorded', async () => {
    const w = world();
    await w.issues.recordReleaseFirstSeen('blue', T0 - 2 * HOUR);
    await w.issues.recordReleaseFirstSeen('green', T0 - HOUR);
    const id = issueIdOf(await assignEvent(summary(T0), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => resolve(s, { kind: 'in_release', release: 'green' }, member, T0));
    await assignEvent(summary(T0 + HOUR, { release: 'blue' }), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved' });
  });

  it("Hand-set priority sticks: Given a member set an issue's Priority, When the issue escalates, Then its Priority does not change", async () => {
    const w = world({ policies: { earlyEscalation: { youngAge: HOUR * 24, minimumCount: 3, rateMultiple: 2 } }, projectNormalRate: 1 });
    const id = issueIdOf(await assignEvent(summary(T0), CRASH_A, deps(w)));
    await command(w.issues, id, (s) => setPriority(s, 'low', member, T0));
    await assignEvent(summary(T0 + MINUTE), CRASH_A, deps(w));
    await assignEvent(summary(T0 + 2 * MINUTE), CRASH_A, deps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ substatus: 'escalating', priority: { level: 'low', setByHand: true } });
  });
});
