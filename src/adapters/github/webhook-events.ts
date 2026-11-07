/**
 * Webhook payloads -- maps a verified GitHub webhook, by its event name and
 * JSON payload, to the domain's provider-neutral values (architecture
 * Mechanism, Code and GitHub): Tracker Events from `issues` (closed with
 * its state reason, reopened), `issue_comment` (created),
 * `installation` (deleted) and `installation_repositories` (removed); and
 * Commits from `push` to the default branch and merged `pull_request`.
 *
 * Call only after `verifyWebhook`. A payload of an unexpected shape, or an
 * event or action Nightwatch does not act on, maps to nothing; nothing here
 * throws. A missing close reason counts as completed, as GitHub's default.
 * A comment author has write access when GitHub names them an owner, member
 * or collaborator of the Repository.
 */

import { z } from 'zod';
import type { Commit } from '../../domain/release/commit.js';
import type { CloseReason } from '../../domain/tracker/external-link.js';
import type { TrackerEvent } from '../../domain/tracker/tracker-event.js';

const WRITE_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

const RepositoryShape = z.object({ full_name: z.string() });
const LoginShape = z.object({ login: z.string() });

const IssuesShape = z.object({
  action: z.string(),
  issue: z.object({ number: z.number().int(), state_reason: z.string().nullish() }),
  repository: RepositoryShape,
  sender: LoginShape,
});

const CommentShape = z.object({
  action: z.literal('created'),
  issue: z.object({ number: z.number().int() }),
  comment: z.object({ body: z.string(), user: LoginShape, author_association: z.string() }),
  repository: RepositoryShape,
});

const InstallationShape = z.object({ action: z.literal('deleted'), repositories: z.array(RepositoryShape).default([]) });

const InstallationRepositoriesShape = z.object({ action: z.literal('removed'), repositories_removed: z.array(RepositoryShape) });

const PushShape = z.object({
  ref: z.string(),
  repository: RepositoryShape.extend({ default_branch: z.string() }),
  commits: z.array(z.object({ id: z.string(), message: z.string() })),
});

const PullRequestShape = z.object({
  action: z.literal('closed'),
  pull_request: z.object({ merged: z.boolean(), merge_commit_sha: z.string().nullable(), title: z.string(), body: z.string().nullable() }),
  repository: RepositoryShape,
});

// --- helpers ---

function closeReasonOf(stateReason: string | null | undefined): CloseReason {
  return stateReason === 'not_planned' ? 'not_planned' : 'completed';
}

function issueEvents(payload: unknown): TrackerEvent[] {
  const parsed = IssuesShape.safeParse(payload);
  if (!parsed.success) return [];
  const { action, issue, repository, sender } = parsed.data;
  const about = { repository: repository.full_name, number: issue.number, actor: sender.login };
  if (action === 'closed') return [{ kind: 'issue_closed', ...about, reason: closeReasonOf(issue.state_reason) }];
  if (action === 'reopened') return [{ kind: 'issue_reopened', ...about }];
  return [];
}

function commentEvents(payload: unknown): TrackerEvent[] {
  const parsed = CommentShape.safeParse(payload);
  if (!parsed.success) return [];
  const { issue, comment, repository } = parsed.data;
  const author = { login: comment.user.login, canWrite: WRITE_ASSOCIATIONS.includes(comment.author_association) };
  return [{ kind: 'comment_created', repository: repository.full_name, number: issue.number, author, body: comment.body }];
}

function installationEvents(payload: unknown): TrackerEvent[] {
  const parsed = InstallationShape.safeParse(payload);
  if (!parsed.success) return [];
  return [{ kind: 'installation_removed', repositories: parsed.data.repositories.map((repository) => repository.full_name) }];
}

function repositoryRemovalEvents(payload: unknown): TrackerEvent[] {
  const parsed = InstallationRepositoriesShape.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.repositories_removed.map((repository) => ({ kind: 'repository_removed', repository: repository.full_name }));
}

function pushCommits(payload: unknown): Commit[] {
  const parsed = PushShape.safeParse(payload);
  if (!parsed.success) return [];
  const { ref, repository, commits } = parsed.data;
  if (ref !== `refs/heads/${repository.default_branch}`) return [];
  return commits.map((commit) => ({ repository: repository.full_name, hash: commit.id, message: commit.message, release: null }));
}

function mergedCommits(payload: unknown): Commit[] {
  const parsed = PullRequestShape.safeParse(payload);
  if (!parsed.success) return [];
  const { pull_request: pull, repository } = parsed.data;
  if (!pull.merged || pull.merge_commit_sha === null) return [];
  const message = pull.body ? `${pull.title}\n\n${pull.body}` : pull.title;
  return [{ repository: repository.full_name, hash: pull.merge_commit_sha, message, release: null }];
}

// --- exports ---

/** The Tracker Events a webhook carries; empty for anything Nightwatch does not act on. */
export function trackerEventsOf(eventName: string, payload: unknown): TrackerEvent[] {
  switch (eventName) {
    case 'issues':
      return issueEvents(payload);
    case 'issue_comment':
      return commentEvents(payload);
    case 'installation':
      return installationEvents(payload);
    case 'installation_repositories':
      return repositoryRemovalEvents(payload);
    default:
      return [];
  }
}

/** The Commits a webhook carries; empty for anything but a default-branch push or a merged pull request. */
export function commitsOf(eventName: string, payload: unknown): Commit[] {
  if (eventName === 'push') return pushCommits(payload);
  if (eventName === 'pull_request') return mergedCommits(payload);
  return [];
}
