// Shared builders for the issue use-case tests: a fresh set of fakes per
// test, Event Summaries, and a way to put an Issue in a state a member
// command would have left it in.
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import type { IssuePolicies } from '../../../../src/domain/issue/policies.js';
import type { IssueState, IssueTransition } from '../../../../src/domain/issue/state.js';
import { isRefusal, type Refusal } from '../../../../src/domain/refusal.js';
import { FakeBlobStore } from '../../../_fakes/blob-store.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeIssueStore } from '../../../_fakes/issue-store.js';
import { DAY, HOUR, MINUTE, T0, policies as basePolicies } from '../../domain/issue/fixtures.js';

export { DAY, HOUR, MINUTE, T0 };

export const DEDUP_WINDOW = DAY;

export function world(options: { policies?: Partial<IssuePolicies>; projectNormalRate?: number } = {}) {
  const issues = new FakeIssueStore({ dedupWindow: DEDUP_WINDOW, projectNormalRate: options.projectNormalRate ?? 1 });
  const clock = new FakeClock(T0);
  const ids = new FakeIds('issue');
  const effects = new FakeEffectQueue();
  const blobs = new FakeBlobStore();
  const policies: IssuePolicies = { ...basePolicies, ...options.policies };
  return { issues, clock, ids, effects, blobs, policies };
}

let eventCounter = 0;

/** An error Event Summary at `at`, with a fresh Event Id unless one is given. */
export function summary(at: number, overrides: Partial<EventSummary> = {}): EventSummary {
  eventCounter += 1;
  return {
    eventId: `event-${eventCounter}`,
    at,
    release: null,
    environment: 'production',
    level: 'error',
    userKey: null,
    title: 'TypeError: x is undefined',
    culprit: 'app/checkout',
    ...overrides,
  };
}

export async function stateOf(issues: FakeIssueStore, issueId: string): Promise<IssueState> {
  const state = await issues.getIssue(issueId);
  if (!state) throw new Error(`no issue ${issueId}`);
  return state;
}

/** Applies a domain command to a stored Issue, as the member's use case would. */
export async function command(
  issues: FakeIssueStore,
  issueId: string,
  run: (state: IssueState) => IssueTransition | Refusal,
): Promise<IssueState> {
  const result = run(await stateOf(issues, issueId));
  if (isRefusal(result)) throw new Error(result.refusal);
  await issues.putIssue(result.state);
  return result.state;
}

export function issueIdOf(assignment: object): string {
  if (!('issueId' in assignment) || typeof assignment.issueId !== 'string') throw new Error('not assigned to an issue');
  return assignment.issueId;
}
