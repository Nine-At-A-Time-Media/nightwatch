// The GitHub App adapter's requests: their method, path, credentials and
// body, and how installation tokens are minted and cached. FakeGitHub serves
// an injected fetch; no request reaches the network.
import { beforeAll, describe, expect, it } from 'vitest';
import { GitHubTracker } from '../../../../src/adapters/github/github-tracker.js';
import { MemoryTokenCache } from '../../../../src/adapters/github/token-cache.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeGitHub } from '../../../_fakes/fake-github.js';
import { appKey, type AppKey } from './app-key.js';

const T0 = Date.parse('2026-11-07T12:00:00Z');
const MINUTE = 60_000;
const REPOSITORY = 'acme/web';

// One key pair for the file: generating RSA keys is slow, and the key is never mutated.
let key: AppKey;
beforeAll(async () => {
  key = await appKey();
});

function setup(options: { fetch?: typeof fetch } = {}) {
  const clock = new FakeClock(T0);
  const github = new FakeGitHub({ appId: '12345', publicKey: key.publicKey, clock, installations: { acme: 77 } });
  const tokens = new MemoryTokenCache();
  const tracker = new GitHubTracker({ appId: '12345', privateKey: key.privateKeyPem, fetch: options.fetch ?? github.fetch, tokens, clock });
  return { clock, github, tokens, tracker };
}

describe('GitHubTracker', () => {
  it('mints an installation token with the App JWT, then opens the issue with that token', async () => {
    const { github, tracker } = setup();

    expect(await tracker.openIssue({ repository: REPOSITORY, title: 'TypeError', body: 'evidence', labels: ['nightwatch'] })).toEqual({
      number: 1,
    });

    expect(github.requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/repos/acme/web/installation'],
      ['POST', '/app/installations/77/access_tokens'],
      ['POST', '/repos/acme/web/issues'],
    ]);
    const [lookup, mint, open] = github.requests;
    expect(lookup?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(mint?.authorization).toBe(lookup?.authorization);
    expect(open?.authorization).toBe('Bearer ghs_fake1');
    expect(open?.accept).toBe('application/vnd.github+json');
    expect(open?.body).toEqual({ title: 'TypeError', body: 'evidence', labels: ['nightwatch'] });
  });

  it('closes with the state reason, reopens, reads, and comments on the issue path', async () => {
    const { github, tracker } = setup();
    await tracker.openIssue({ repository: REPOSITORY, title: 't', body: 'b', labels: [] });
    github.requests.length = 0;

    await tracker.closeIssue({ repository: REPOSITORY, number: 1, reason: 'not_planned' });
    await tracker.reopenIssue({ repository: REPOSITORY, number: 1 });
    await tracker.getIssue({ repository: REPOSITORY, number: 1 });
    await tracker.postComment({ repository: REPOSITORY, number: 1, body: 'note' });

    expect(github.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['PATCH', '/repos/acme/web/issues/1', { state: 'closed', state_reason: 'not_planned' }],
      ['PATCH', '/repos/acme/web/issues/1', { state: 'open' }],
      ['GET', '/repos/acme/web/issues/1', null],
      ['POST', '/repos/acme/web/issues/1/comments', { body: 'note' }],
    ]);
    expect(github.requests.every((request) => request.authorization === 'Bearer ghs_fake1')).toBe(true);
  });

  it('reuses a cached token until shortly before it expires, then mints another', async () => {
    const { clock, github, tracker } = setup();
    await tracker.openIssue({ repository: REPOSITORY, title: 't', body: 'b', labels: [] });

    clock.set(T0 + 50 * MINUTE);
    await tracker.getIssue({ repository: REPOSITORY, number: 1 });
    expect(github.minted).toBe(1);

    clock.set(T0 + 56 * MINUTE);
    await tracker.getIssue({ repository: REPOSITORY, number: 1 });
    expect(github.minted).toBe(2);
    expect(github.requests.at(-1)?.authorization).toBe('Bearer ghs_fake2');
  });

  it('refuses a Repository whose owner has no installation, and a fetch that fails, without throwing', async () => {
    const { tracker } = setup();
    expect(await tracker.getIssue({ repository: 'stranger/repo', number: 1 })).toEqual({ refusal: 'tracker_refused' });

    const unreachable = setup({ fetch: async () => Promise.reject(new TypeError('network down')) });
    expect(await unreachable.tracker.getIssue({ repository: REPOSITORY, number: 1 })).toEqual({ refusal: 'tracker_unreachable' });
  });

  it('refuses a malformed Repository name before any request', async () => {
    const { github, tracker } = setup();

    expect(await tracker.getIssue({ repository: 'not-a-repository', number: 1 })).toEqual({ refusal: 'tracker_refused' });
    expect(await tracker.getIssue({ repository: 'acme/web/../../app', number: 1 })).toEqual({ refusal: 'tracker_refused' });
    expect(github.requests).toEqual([]);
  });
});
