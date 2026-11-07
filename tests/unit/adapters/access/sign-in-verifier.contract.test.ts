import { beforeEach, describe, expect, it } from 'vitest';
import { localKeySource, remoteKeySource } from '../../../../src/adapters/access/key-source.js';
import { AccessSignInVerifier } from '../../../../src/adapters/access/access-sign-in-verifier.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { TrustedIssuer } from '../../../../src/domain/signin/sign-in.js';
import type { SignInVerifier } from '../../../../src/ports/sign-in-verifier.js';
import { LocalIssuer } from '../../../../dev/local-issuer/local-issuer.js';
import { FakeSignInVerifier } from '../../../_fakes/sign-in-verifier.js';

const TRUSTED_URL = 'https://acme.cloudflareaccess.com';
const UNTRUSTED_URL = 'https://evil.cloudflareaccess.com';
const AUDIENCE = 'aud-console';
const NOW = new Date('2026-11-07T12:00:00Z');
const TRUSTED: readonly TrustedIssuer[] = [{ issuer: TRUSTED_URL, audiences: [AUDIENCE] }];
const CLOCK = { now: (): Date => NOW };

type AssertionRequest = {
  readonly email: string;
  readonly aud: string;
  readonly ttlSeconds: number;
  readonly issuedAt: Date;
  readonly from: 'trusted' | 'untrusted';
};

type Harness = {
  readonly verifier: SignInVerifier;
  /** An assertion signed by the named issuer's own key. */
  readonly assertion: (request: AssertionRequest) => Promise<string>;
  /** An assertion naming the trusted issuer but signed by a key it does not hold. */
  readonly forged: (request: AssertionRequest) => Promise<string>;
};

async function makeAccessHarness(): Promise<Harness> {
  const issuers = { trusted: await LocalIssuer.create(TRUSTED_URL), untrusted: await LocalIssuer.create(UNTRUSTED_URL) };
  const impostor = await LocalIssuer.create(TRUSTED_URL);
  const keys = localKeySource({ [TRUSTED_URL]: issuers.trusted.jwks, [UNTRUSTED_URL]: issuers.untrusted.jwks });
  return {
    verifier: new AccessSignInVerifier({ keys, clock: CLOCK }),
    assertion: (request) => issuers[request.from].mint(request),
    forged: (request) => impostor.mint(request),
  };
}

function makeFakeHarness(): Harness {
  const verifier = new FakeSignInVerifier({ clock: CLOCK });
  let minted = 0;
  return {
    verifier,
    assertion: async (request) => {
      minted += 1;
      const assertion = `fake-assertion-${minted}`;
      verifier.register(assertion, {
        email: request.email,
        issuer: request.from === 'trusted' ? TRUSTED_URL : UNTRUSTED_URL,
        audience: request.aud,
        expiresAt: new Date(request.issuedAt.getTime() + request.ttlSeconds * 1000),
      });
      return assertion;
    },
    forged: async () => 'fake-assertion-never-registered',
  };
}

function request(overrides: Partial<AssertionRequest> = {}): AssertionRequest {
  return { email: 'Ada@Example.com', aud: AUDIENCE, ttlSeconds: 300, issuedAt: NOW, from: 'trusted', ...overrides };
}

describe.each<{ name: string; make: () => Promise<Harness> }>([
  { name: 'FakeSignInVerifier', make: async () => makeFakeHarness() },
  { name: 'AccessSignInVerifier', make: makeAccessHarness },
])('SignInVerifier contract -- $name', ({ make }) => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await make();
  });

  it('yields a Sign-in with the lowercased email for a valid assertion from a trusted issuer', async () => {
    const result = await harness.verifier.verify(await harness.assertion(request()), TRUSTED);
    expect(result).toEqual({
      email: 'ada@example.com',
      issuer: TRUSTED_URL,
      audience: AUDIENCE,
      expiresAt: new Date(NOW.getTime() + 300_000),
    });
  });

  it('refuses an expired assertion', async () => {
    const assertion = await harness.assertion(request({ issuedAt: new Date(NOW.getTime() - 600_000), ttlSeconds: 300 }));
    expect(await harness.verifier.verify(assertion, TRUSTED)).toEqual({ refusal: 'expired' });
  });

  it('refuses an assertion for an audience the issuer is not trusted for', async () => {
    const assertion = await harness.assertion(request({ aud: 'aud-other' }));
    expect(await harness.verifier.verify(assertion, TRUSTED)).toEqual({ refusal: 'wrong-audience' });
  });

  it('refuses an assertion from an issuer the Organization does not trust', async () => {
    const assertion = await harness.assertion(request({ from: 'untrusted' }));
    expect(await harness.verifier.verify(assertion, TRUSTED)).toEqual({ refusal: 'untrusted-issuer' });
  });

  it('refuses an assertion signed by a key the issuer does not hold', async () => {
    const assertion = await harness.forged(request());
    expect(await harness.verifier.verify(assertion, TRUSTED)).toEqual({ refusal: 'unverified-sign-in' });
  });

  it('refuses garbage', async () => {
    for (const garbage of ['', 'not-a-token', 'a.b.c']) {
      expect(await harness.verifier.verify(garbage, TRUSTED)).toEqual({ refusal: 'unverified-sign-in' });
    }
  });

  it('identifies nobody when the Organization trusts no issuer', async () => {
    expect(isRefusal(await harness.verifier.verify(await harness.assertion(request()), []))).toBe(true);
  });
});

describe('Access key source', () => {
  it("fetches each trusted issuer's keys from its certs path once, and never an untrusted issuer's", async () => {
    const trusted = await LocalIssuer.create(TRUSTED_URL);
    const untrusted = await LocalIssuer.create(UNTRUSTED_URL);
    const fetched: string[] = [];
    const keys = remoteKeySource({
      fetch: async (url: string) => {
        fetched.push(url);
        return Response.json(trusted.jwks);
      },
    });
    const verifier = new AccessSignInVerifier({ keys, clock: CLOCK });

    const first = await verifier.verify(await trusted.mint(request()), TRUSTED);
    const second = await verifier.verify(await trusted.mint(request({ email: 'bob@example.com' })), TRUSTED);
    const refused = await verifier.verify(await untrusted.mint(request()), TRUSTED);

    expect(first).toMatchObject({ email: 'ada@example.com' });
    expect(second).toMatchObject({ email: 'bob@example.com' });
    expect(refused).toEqual({ refusal: 'untrusted-issuer' });
    expect(fetched).toEqual([`${TRUSTED_URL}/cdn-cgi/access/certs`]);
  });
});
