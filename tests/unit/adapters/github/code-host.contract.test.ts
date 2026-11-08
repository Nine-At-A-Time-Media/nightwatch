// The CodeHost contract, run over the FakeCodeHost and the GitHub App
// adapter (backed by FakeGitHub through an injected fetch), so the fake the
// use-case tests rely on cannot drift from the adapter.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubCodeHost } from '../../../../src/adapters/github/github-code-host.js';
import { MemoryTokenCache } from '../../../../src/adapters/github/token-cache.js';
import type { BlameRange } from '../../../../src/domain/ownership/suspect-commit.js';
import type { CodeHost } from '../../../../src/ports/code-host.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeCodeHost, type HostedFile } from '../../../_fakes/fake-code-host.js';
import { FakeGitHub } from '../../../_fakes/fake-github.js';
import { appKey, type AppKey } from './app-key.js';

const REPOSITORY = 'acme/web';
const T0 = Date.parse('2026-11-01T10:00:00Z');
const RANGES: BlameRange[] = [
  { startingLine: 1, endingLine: 10, commit: { hash: 'a'.repeat(40), author: { email: 'ada@acme.example', login: 'ada-gh' }, at: T0 } },
  { startingLine: 11, endingLine: 40, commit: { hash: 'b'.repeat(40), author: { email: 'bob@acme.example', login: null }, at: T0 + 1000 } },
];
const FILE: HostedFile = {
  repository: REPOSITORY,
  path: 'src/pay.ts',
  ref: 'main',
  text: 'export const total = 1; // café\n',
  blame: RANGES,
};

// One key pair for the file: generating RSA keys is slow, and the key is never mutated.
let key: AppKey;
beforeAll(async () => {
  key = await appKey();
});

type Harness = { host: CodeHost; put: (file: HostedFile) => void; refuse: () => void };

function fakeHarness(): Harness {
  const host = new FakeCodeHost();
  return { host, put: (file) => host.putFile(file), refuse: () => (host.refusing = { refusal: 'code_refused' }) };
}

function gitHubHarness(): Harness {
  const clock = new FakeClock(Date.parse('2026-11-07T12:00:00Z'));
  const github = new FakeGitHub({ appId: '12345', publicKey: key.publicKey, clock, installations: { acme: 77 } });
  const host = new GitHubCodeHost({
    appId: '12345',
    privateKey: key.privateKeyPem,
    fetch: github.fetch,
    tokens: new MemoryTokenCache(),
    clock,
  });
  return { host, put: (file) => github.putFile(file), refuse: () => (github.refusing = 403) };
}

describe.each([
  { name: 'FakeCodeHost', make: fakeHarness },
  { name: 'GitHubCodeHost', make: gitHubHarness },
])('CodeHost contract -- $name', ({ make }) => {
  let harness: Harness;
  beforeEach(() => {
    harness = make();
    harness.put(FILE);
  });

  it('blame names the commit whose range holds the line, with its author and time', async () => {
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main', line: 11 })).toEqual(RANGES[1]?.commit);
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main', line: 3 })).toEqual(RANGES[0]?.commit);
  });

  it('blame of a line, file or ref that is not there is not found', async () => {
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main', line: 41 })).toEqual({
      refusal: 'code_not_found',
    });
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/gone.ts', ref: 'main', line: 1 })).toEqual({
      refusal: 'code_not_found',
    });
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'dev', line: 1 })).toEqual({
      refusal: 'code_not_found',
    });
  });

  it("reads a file's text at the ref, and a file that is not there is not found", async () => {
    expect(await harness.host.fileText({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main' })).toBe(FILE.text);
    expect(await harness.host.fileText({ repository: REPOSITORY, path: 'CODEOWNERS', ref: 'main' })).toEqual({ refusal: 'code_not_found' });
  });

  it('a host that refuses refuses every call', async () => {
    harness.refuse();
    expect(await harness.host.fileText({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main' })).toEqual({ refusal: 'code_refused' });
    expect(await harness.host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main', line: 1 })).toEqual({
      refusal: 'code_refused',
    });
  });
});

describe('GitHubCodeHost requests', () => {
  it('blames through GraphQL and reads files through the contents API, as the installation', async () => {
    const clock = new FakeClock(Date.parse('2026-11-07T12:00:00Z'));
    const github = new FakeGitHub({ appId: '12345', publicKey: key.publicKey, clock, installations: { acme: 77 } });
    github.putFile(FILE);
    const host = new GitHubCodeHost({
      appId: '12345',
      privateKey: key.privateKeyPem,
      fetch: github.fetch,
      tokens: new MemoryTokenCache(),
      clock,
    });

    await host.blame({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main', line: 1 });
    await host.fileText({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main' });

    const calls = github.requests.filter((request) => !request.path.includes('installation'));
    expect(calls.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/graphql'],
      ['GET', '/repos/acme/web/contents/src/pay.ts'],
    ]);
    expect(calls[0]?.body).toMatchObject({ variables: { owner: 'acme', name: 'web', ref: 'main', path: 'src/pay.ts' } });
    expect(calls.every((request) => request.authorization === 'Bearer ghs_fake1')).toBe(true);
  });

  it('a host that cannot be reached is unreachable', async () => {
    const host = new GitHubCodeHost({
      appId: '12345',
      privateKey: key.privateKeyPem,
      fetch: () => Promise.reject(new Error('offline')),
      tokens: new MemoryTokenCache(),
      clock: new FakeClock(T0),
    });
    expect(await host.fileText({ repository: REPOSITORY, path: 'src/pay.ts', ref: 'main' })).toEqual({ refusal: 'code_unreachable' });
  });
});
