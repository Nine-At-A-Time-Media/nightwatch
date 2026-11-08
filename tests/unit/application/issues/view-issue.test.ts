import { describe, expect, it } from 'vitest';
import { viewIssue } from '../../../../src/application/issues/view-issue.js';
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { DAY, T0, policies } from '../../domain/issue/fixtures.js';

const PROJECT = 'project-1';
const MIA = { member: 'member-mia' } as const;

function summary(eventId: string, overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    eventId,
    at: T0,
    release: null,
    environment: null,
    level: 'error',
    userKey: null,
    title: 'TypeError',
    culprit: 'app.js',
    ...overrides,
  };
}

function world() {
  const clock = new FakeClock(T0);
  const projects = new FakeProjectClient({ clock, ids: new FakeIds('issue'), effects: new FakeEffectQueue(), policies, dedupWindow: DAY });
  const control = new FakeControlStore();
  control.addProject('org-1', PROJECT);
  control.addProjectSlug(PROJECT, 'web');
  return { clock, projects, control };
}

async function assigned(w: ReturnType<typeof world>, event: EventSummary, fingerprint: string): Promise<string> {
  const assignment = await w.projects.assignEvent(PROJECT, event, [fingerprint]);
  if (!('issueId' in assignment) || typeof assignment.issueId !== 'string') throw new Error('not assigned');
  return assignment.issueId;
}

describe('viewIssue', () => {
  it('shows a Member the Issue, its latest Event, every Comment shared or private, and its External Link', async () => {
    const w = world();
    const issueId = await assigned(w, summary('event-1'), 'fp-1');
    await w.projects.addComment(PROJECT, issueId, { text: 'cache bug?', shared: false }, MIA);
    await w.projects.addComment(PROJECT, issueId, { text: 'we are on it', shared: true }, MIA);
    const view = await viewIssue(PROJECT, issueId, w);
    expect(view).toMatchObject({ state: { issueId }, shortId: 'WEB-1', title: 'TypeError', culprit: 'app.js', externalLink: null });
    expect('comments' in view ? view.comments.map((comment) => [comment.text, comment.shared]) : []).toEqual([
      ['cache bug?', false],
      ['we are on it', true],
    ]);
  });

  it('refuses an Issue the Project does not hold', async () => {
    expect(await viewIssue(PROJECT, 'issue-unknown', world())).toEqual({ refusal: 'issue_not_found' });
  });
});
