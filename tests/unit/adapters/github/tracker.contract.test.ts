// The Tracker contract, run over the FakeTracker and the GitHub App adapter
// (backed by FakeGitHub through an injected fetch), so the fake the use-case
// tests rely on cannot drift from the adapter.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubTracker } from '../../../../src/adapters/github/github-tracker.js';
import { MemoryTokenCache } from '../../../../src/adapters/github/token-cache.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { Tracker } from '../../../../src/ports/tracker.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeGitHub } from '../../../_fakes/fake-github.js';
import { FakeTracker } from '../../../_fakes/fake-tracker.js';
import { appKey, type AppKey } from './app-key.js';

const REPOSITORY = 'acme/web';
const DRAFT = { repository: REPOSITORY, title: 'TypeError: cart is undefined', body: 'evidence', labels: ['nightwatch'] };

// One key pair for the file: generating RSA keys is slow, and the key is never mutated.
let key: AppKey;
beforeAll(async () => {
  key = await appKey();
});

type Harness = { tracker: Tracker; refuse: () => void };

function fakeHarness(): Harness {
  const tracker = new FakeTracker();
  return { tracker, refuse: () => (tracker.refusing = { refusal: 'tracker_refused' }) };
}

function gitHubHarness(): Harness {
  const clock = new FakeClock(Date.parse('2026-11-07T12:00:00Z'));
  const github = new FakeGitHub({ appId: '12345', publicKey: key.publicKey, clock, installations: { acme: 77 } });
  const tracker = new GitHubTracker({
    appId: '12345',
    privateKey: key.privateKeyPem,
    fetch: github.fetch,
    tokens: new MemoryTokenCache(),
    clock,
  });
  return { tracker, refuse: () => (github.refusing = 403) };
}

describe.each([
  { name: 'FakeTracker', make: fakeHarness },
  { name: 'GitHubTracker', make: gitHubHarness },
])('Tracker contract -- $name', ({ make }) => {
  let harness: Harness;
  beforeEach(() => {
    harness = make();
  });

  it('opens an issue that reads back open, numbering issues distinctly per Repository', async () => {
    const first = await harness.tracker.openIssue(DRAFT);
    const second = await harness.tracker.openIssue(DRAFT);
    if (isRefusal(first) || isRefusal(second)) throw new Error('refused');

    expect(first.number).not.toBe(second.number);
    expect(await harness.tracker.getIssue({ repository: REPOSITORY, number: first.number })).toEqual({ state: 'open' });
  });

  it('closes for the reason given and reopens, returning and keeping the new state', async () => {
    const opened = await harness.tracker.openIssue(DRAFT);
    if (isRefusal(opened)) throw new Error('refused');
    const issue = { repository: REPOSITORY, number: opened.number };

    expect(await harness.tracker.closeIssue({ ...issue, reason: 'not_planned' })).toEqual({ state: 'closed', reason: 'not_planned' });
    expect(await harness.tracker.getIssue(issue)).toEqual({ state: 'closed', reason: 'not_planned' });
    expect(await harness.tracker.reopenIssue(issue)).toEqual({ state: 'open' });
    expect(await harness.tracker.closeIssue({ ...issue, reason: 'completed' })).toEqual({ state: 'closed', reason: 'completed' });
  });

  it('posts a comment and returns its id', async () => {
    const opened = await harness.tracker.openIssue(DRAFT);
    if (isRefusal(opened)) throw new Error('refused');

    const posted = await harness.tracker.postComment({ repository: REPOSITORY, number: opened.number, body: 'A note' });

    expect(isRefusal(posted) ? posted : typeof posted.id).toBe('number');
  });

  it('answers an unknown issue with tracker_not_found', async () => {
    const unknown = { repository: REPOSITORY, number: 404 };

    expect(await harness.tracker.getIssue(unknown)).toEqual({ refusal: 'tracker_not_found' });
    expect(await harness.tracker.closeIssue({ ...unknown, reason: 'completed' })).toEqual({ refusal: 'tracker_not_found' });
    expect(await harness.tracker.postComment({ ...unknown, body: 'x' })).toEqual({ refusal: 'tracker_not_found' });
  });

  it('answers a refused write with tracker_refused, and throws nothing', async () => {
    const opened = await harness.tracker.openIssue(DRAFT);
    if (isRefusal(opened)) throw new Error('refused');
    harness.refuse();

    expect(await harness.tracker.closeIssue({ repository: REPOSITORY, number: opened.number, reason: 'completed' })).toEqual({
      refusal: 'tracker_refused',
    });
    expect(await harness.tracker.openIssue(DRAFT)).toEqual({ refusal: 'tracker_refused' });
  });
});
