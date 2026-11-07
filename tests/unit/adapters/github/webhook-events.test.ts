import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitsOf, trackerEventsOf } from '../../../../src/adapters/github/webhook-events.js';

const repository = { full_name: 'acme/web', default_branch: 'main' };
const sender = { login: 'octocat' };

function issues(action: string, issue: Record<string, unknown> = {}): unknown {
  return { action, issue: { number: 7, state: 'closed', state_reason: 'completed', ...issue }, repository, sender };
}

describe('trackerEventsOf', () => {
  it('maps a closed issue with its state reason, defaulting a missing reason to completed', () => {
    expect(trackerEventsOf('issues', issues('closed'))).toEqual([
      { kind: 'issue_closed', repository: 'acme/web', number: 7, reason: 'completed', actor: 'octocat' },
    ]);
    expect(trackerEventsOf('issues', issues('closed', { state_reason: 'not_planned' }))).toEqual([
      { kind: 'issue_closed', repository: 'acme/web', number: 7, reason: 'not_planned', actor: 'octocat' },
    ]);
    expect(trackerEventsOf('issues', issues('closed', { state_reason: null }))).toEqual([
      { kind: 'issue_closed', repository: 'acme/web', number: 7, reason: 'completed', actor: 'octocat' },
    ]);
  });

  it('maps a reopened issue', () => {
    expect(trackerEventsOf('issues', issues('reopened', { state: 'open', state_reason: 'reopened' }))).toEqual([
      { kind: 'issue_reopened', repository: 'acme/web', number: 7, actor: 'octocat' },
    ]);
  });

  it('maps a created comment, with write access from its author association', () => {
    const comment = (association: string): unknown => ({
      action: 'created',
      issue: { number: 7 },
      comment: { body: '/reporter\nThanks', user: { login: 'mia-gh' }, author_association: association },
      repository,
      sender: { login: 'mia-gh' },
    });

    expect(trackerEventsOf('issue_comment', comment('MEMBER'))).toEqual([
      {
        kind: 'comment_created',
        repository: 'acme/web',
        number: 7,
        author: { login: 'mia-gh', canWrite: true },
        body: '/reporter\nThanks',
      },
    ]);
    for (const association of ['OWNER', 'COLLABORATOR']) {
      expect(trackerEventsOf('issue_comment', comment(association))).toMatchObject([{ author: { canWrite: true } }]);
    }
    for (const association of ['CONTRIBUTOR', 'NONE', 'FIRST_TIME_CONTRIBUTOR']) {
      expect(trackerEventsOf('issue_comment', comment(association))).toMatchObject([{ author: { canWrite: false } }]);
    }
  });

  it('maps a deleted installation and Repositories removed from one', () => {
    expect(
      trackerEventsOf('installation', {
        action: 'deleted',
        installation: { id: 5 },
        repositories: [{ full_name: 'acme/web' }, { full_name: 'acme/api' }],
        sender,
      }),
    ).toEqual([{ kind: 'installation_removed', repositories: ['acme/web', 'acme/api'] }]);
    expect(
      trackerEventsOf('installation_repositories', {
        action: 'removed',
        installation: { id: 5 },
        repositories_removed: [{ full_name: 'acme/web' }, { full_name: 'acme/api' }],
        sender,
      }),
    ).toEqual([
      { kind: 'repository_removed', repository: 'acme/web' },
      { kind: 'repository_removed', repository: 'acme/api' },
    ]);
  });

  it('maps nothing for other events and actions, and for payloads of the wrong shape', () => {
    expect(trackerEventsOf('issues', issues('labeled'))).toEqual([]);
    expect(trackerEventsOf('issue_comment', { action: 'edited' })).toEqual([]);
    expect(trackerEventsOf('star', { action: 'created' })).toEqual([]);
    expect(trackerEventsOf('issues', { action: 'closed', issue: { number: 'seven' } })).toEqual([]);
  });

  it('never throws, whatever JSON arrives', () => {
    const names = fc.constantFrom('issues', 'issue_comment', 'installation', 'installation_repositories', 'push', 'pull_request');
    fc.assert(
      fc.property(names, fc.jsonValue(), (name, payload) => {
        expect(Array.isArray(trackerEventsOf(name, payload))).toBe(true);
        expect(Array.isArray(commitsOf(name, payload))).toBe(true);
      }),
    );
  });
});

describe('commitsOf', () => {
  it('maps the commits of a push to the default branch, with no Release yet', () => {
    const push = {
      ref: 'refs/heads/main',
      repository,
      commits: [
        { id: 'aaa111', message: 'Fixes WEB-3' },
        { id: 'bbb222', message: 'Tidy' },
      ],
    };

    expect(commitsOf('push', push)).toEqual([
      { repository: 'acme/web', hash: 'aaa111', message: 'Fixes WEB-3', release: null },
      { repository: 'acme/web', hash: 'bbb222', message: 'Tidy', release: null },
    ]);
    expect(commitsOf('push', { ...push, ref: 'refs/heads/feature' })).toEqual([]);
  });

  it('maps a merged pull request to its merge commit, with its title and body as the message', () => {
    const pull = (merged: boolean, body: string | null): unknown => ({
      action: 'closed',
      pull_request: { merged, merge_commit_sha: 'ccc333', title: 'Guard the cart', body },
      repository,
    });

    expect(commitsOf('pull_request', pull(true, 'Fixes WEB-3'))).toEqual([
      { repository: 'acme/web', hash: 'ccc333', message: 'Guard the cart\n\nFixes WEB-3', release: null },
    ]);
    expect(commitsOf('pull_request', pull(true, null))).toEqual([
      { repository: 'acme/web', hash: 'ccc333', message: 'Guard the cart', release: null },
    ]);
    expect(commitsOf('pull_request', pull(false, 'Fixes WEB-3'))).toEqual([]);
    expect(commitsOf('issues', issues('closed'))).toEqual([]);
  });
});
