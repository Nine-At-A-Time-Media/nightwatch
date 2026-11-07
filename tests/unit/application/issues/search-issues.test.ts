// searchIssues -- the console's search over every Project of the viewer's
// Organization, driven by its architecture signature with in-memory fakes:
// Projects and Membership in the FakeControlStore, each Project's Issues
// behind the FakeProjectClient.
import { describe, expect, it } from 'vitest';
import { searchIssues } from '../../../../src/application/issues/search-issues.js';
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { IssuePage } from '../../../../src/domain/search/page.js';
import { parseIssueQuery } from '../../../../src/domain/search/parse.js';
import type { IssueQuery } from '../../../../src/domain/search/query.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { DAY, HOUR, T0, policies } from '../../domain/issue/fixtures.js';

const ACME = 'org-acme';
const GLOBEX = 'org-globex';
const WEB = 'web';
const API = 'api';
const RIVAL = 'rival';
const ana = { member: 'member-ana' } as const;
const ANA = 'ana@acme.example';
const gus = { member: 'member-gus' } as const;
const GUS = 'gus@globex.example';

function query(text: string): IssueQuery {
  const parsed = parseIssueQuery(text);
  if (isRefusal(parsed)) throw new Error(parsed.refusal);
  return parsed;
}

function world() {
  const clock = new FakeClock(T0 + 3 * DAY);
  const control = new FakeControlStore();
  control.addProject(ACME, WEB);
  control.addProject(ACME, API);
  control.addProject(GLOBEX, RIVAL);
  control.addMembership(ana, { organizationId: ACME, role: 'member' });
  control.addMembership(gus, { organizationId: GLOBEX, role: 'member' });
  control.addMember(WEB, ana, { email: ANA });
  control.addMember(RIVAL, gus, { email: GUS });
  const projects = new FakeProjectClient({
    clock,
    ids: new FakeIds('issue'),
    effects: new FakeEffectQueue(),
    policies,
    dedupWindow: DAY,
    memberEmails: new Map([
      [ana.member, ANA],
      [gus.member, GUS],
    ]),
  });
  return { clock, control, projects, deps: { control, projects, clock } };
}

let eventCounter = 0;

function summary(overrides: Partial<EventSummary> = {}): EventSummary {
  eventCounter += 1;
  return {
    eventId: `event-${eventCounter}`,
    at: T0,
    release: null,
    environment: 'production',
    level: 'error',
    userKey: null,
    title: 'TypeError: total is undefined',
    culprit: 'app/checkout',
    ...overrides,
  };
}

/** Opens an Issue in the Project with one Event of the release, as processing would, and returns its id. */
async function issueIn(w: ReturnType<typeof world>, opening: { project: string; fingerprint: string; release: string; at?: number }) {
  await w.projects.recordReleaseSeen(opening.project, opening.release);
  const assignment = await w.projects.assignEvent(opening.project, summary({ release: opening.release, at: opening.at ?? T0 }), [
    opening.fingerprint,
  ]);
  if (!('issueId' in assignment)) throw new Error('not assigned');
  return assignment.issueId;
}

async function archiveForever(w: ReturnType<typeof world>, project: string, issueId: string): Promise<void> {
  const store = w.projects.store(project);
  const state = await store.getIssue(issueId);
  if (state === null) throw new Error(`no issue ${issueId}`);
  await store.putIssue({ ...state, status: 'archived', substatus: 'forever', spam: false });
}

function ids(page: IssuePage | { refusal: string }): readonly string[] {
  if (isRefusal(page)) throw new Error(page.refusal);
  return page.issues.map((issue) => issue.state.issueId);
}

describe('searchIssues', () => {
  it("Search: Given issues in several states, When a member searches `is:unresolved assigned:me release:latest`, Then only matching issues in that member's Organization are returned", async () => {
    const w = world();
    const match = await issueIn(w, { project: WEB, fingerprint: 'match', release: 'web@2.0.0' });
    const otherProject = await issueIn(w, { project: API, fingerprint: 'api-match', release: 'web@2.0.0', at: T0 + HOUR });
    const oldRelease = await issueIn(w, { project: WEB, fingerprint: 'old', release: 'web@1.0.0' });
    const unassigned = await issueIn(w, { project: WEB, fingerprint: 'unassigned', release: 'web@2.0.0' });
    const archived = await issueIn(w, { project: WEB, fingerprint: 'archived', release: 'web@2.0.0' });
    const someoneElse = await issueIn(w, { project: WEB, fingerprint: 'else', release: 'web@2.0.0' });
    for (const issueId of [match, oldRelease, archived]) w.projects.store(WEB).setAssignee(issueId, ana);
    w.projects.store(API).setAssignee(otherProject, ana);
    w.projects.store(WEB).setAssignee(someoneElse, gus);
    await archiveForever(w, WEB, archived);

    const page = await searchIssues(query('is:unresolved assigned:me release:latest'), ana, null, w.deps);

    expect(ids(page)).toEqual([otherProject, match]);
    expect(ids(page)).not.toContain(unassigned);
  });

  it('Cross-tenant search: Given issues in two Organizations, When a member of one searches, Then no issue from the other is returned', async () => {
    const w = world();
    const own = await issueIn(w, { project: WEB, fingerprint: 'same', release: 'web@1.0.0' });
    const rival = await issueIn(w, { project: RIVAL, fingerprint: 'same', release: 'web@1.0.0' });

    const page = await searchIssues(query('is:unresolved'), ana, null, w.deps);

    expect(ids(page)).toEqual([own]);
    expect(ids(page)).not.toContain(rival);
    expect(ids(await searchIssues(query('is:unresolved'), gus, null, w.deps))).toEqual([rival]);
  });

  it('pages through the Organization with the Cursor the previous page returned', async () => {
    const w = world();
    const created: string[] = [];
    for (let n = 0; n < 30; n += 1) {
      created.push(await issueIn(w, { project: n % 2 === 0 ? WEB : API, fingerprint: `fp-${n}`, release: 'web@1.0.0', at: T0 + n }));
    }
    const first = await searchIssues(query('is:unresolved'), ana, null, w.deps);
    if (isRefusal(first)) throw new Error(first.refusal);
    expect(first.next).not.toBeNull();
    const second = await searchIssues(query('is:unresolved'), ana, first.next, w.deps);
    expect([...ids(first), ...ids(second)]).toEqual([...created].reverse());
    expect(isRefusal(second) ? 'refused' : second.next).toBeNull();
  });

  it('refuses a viewer who belongs to no Organization, and a Cursor another query issued', async () => {
    const w = world();
    expect(await searchIssues(query('is:unresolved'), { member: 'stranger' }, null, w.deps)).toEqual({ refusal: 'not_a_member' });
    for (let n = 0; n < 30; n += 1) await issueIn(w, { project: WEB, fingerprint: `fp-${n}`, release: 'web@1.0.0', at: T0 + n });
    const first = await searchIssues(query('is:unresolved'), ana, null, w.deps);
    if (isRefusal(first) || first.next === null) throw new Error('expected a second page');
    expect(isRefusal(await searchIssues(query('is:resolved'), ana, first.next, w.deps))).toBe(true);
  });
});
