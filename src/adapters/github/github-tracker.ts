/**
 * GitHubTracker -- the Tracker backed by a GitHub App's REST API
 * (architecture Seams: Issue tracker; Mechanism, Code and GitHub).
 *
 * Each call acts as the App's installation on the Repository's owner,
 * through GitHubApp, which mints and caches installation tokens. `fetch` and
 * the clock are injected, so tests reach no network. Every failure becomes a
 * Refusal: 404 is `tracker_not_found`, any other refusal `tracker_refused`,
 * and a request that cannot be made `tracker_unreachable`.
 */

import { z } from 'zod';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { CloseReason, Repository, TrackerState } from '../../domain/tracker/external-link.js';
import type { Tracker, TrackerIssueDraft, TrackerIssueRef } from '../../ports/tracker.js';
import { GitHubApp, type GitHubAppOptions, type GitHubCall } from './github-app.js';

export type GitHubTrackerOptions = GitHubAppOptions;

const REFUSALS = {
  notFound: refusal('tracker_not_found'),
  refused: refusal('tracker_refused'),
  unreachable: refusal('tracker_unreachable'),
};

const IssueShape = z.object({ number: z.number().int(), state: z.enum(['open', 'closed']), state_reason: z.string().nullish() });
const CommentShape = z.object({ id: z.number().int() });

// --- helpers ---

function stateOf(issue: z.infer<typeof IssueShape>): TrackerState {
  if (issue.state === 'open') return { state: 'open' };
  const reason: CloseReason = issue.state_reason === 'not_planned' ? 'not_planned' : 'completed';
  return { state: 'closed', reason };
}

// --- exports ---

export class GitHubTracker implements Tracker {
  readonly #app: GitHubApp;

  constructor(options: GitHubTrackerOptions) {
    this.#app = new GitHubApp(options, REFUSALS);
  }

  async openIssue(draft: TrackerIssueDraft): Promise<{ readonly number: number } | Refusal> {
    const body = { title: draft.title, body: draft.body, labels: draft.labels };
    const issue = await this.#issueCall(draft.repository, { method: 'POST', path: '/issues', body }, IssueShape);
    return isRefusal(issue) ? issue : { number: issue.number };
  }

  async closeIssue(close: TrackerIssueRef & { readonly reason: CloseReason }): Promise<TrackerState | Refusal> {
    const body = { state: 'closed', state_reason: close.reason };
    return this.#issueState(close.repository, { method: 'PATCH', path: `/issues/${close.number}`, body });
  }

  async reopenIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    return this.#issueState(issue.repository, { method: 'PATCH', path: `/issues/${issue.number}`, body: { state: 'open' } });
  }

  async postComment(comment: TrackerIssueRef & { readonly body: string }): Promise<{ readonly id: number } | Refusal> {
    const call = { method: 'POST', path: `/issues/${comment.number}/comments`, body: { body: comment.body } };
    const posted = await this.#issueCall(comment.repository, call, CommentShape);
    return isRefusal(posted) ? posted : { id: posted.id };
  }

  async getIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    return this.#issueState(issue.repository, { method: 'GET', path: `/issues/${issue.number}` });
  }

  // --- flow: issue calls ---

  async #issueState(repository: Repository, call: GitHubCall): Promise<TrackerState | Refusal> {
    const issue = await this.#issueCall(repository, call, IssueShape);
    return isRefusal(issue) ? issue : stateOf(issue);
  }

  async #issueCall<T>(repository: Repository, call: GitHubCall, shape: z.ZodType<T>): Promise<T | Refusal> {
    return this.#app.asInstallation(repository, (parts) => ({ ...call, path: `/repos/${parts.owner}/${parts.name}${call.path}` }), shape);
  }
}
