// The local issuer Worker's routes, answered by a plain function over a
// LocalIssuer: the published keys at the Access certs path, and the dev
// sign-in helper that mints an Assertion the AccessSignInVerifier accepts.
// A restored issuer signs with the key pair it was saved with, so one
// checkout keeps one issuer across restarts.
import { describe, expect, it } from 'vitest';
import { AccessSignInVerifier } from '../../../src/adapters/access/access-sign-in-verifier.js';
import { localKeySource } from '../../../src/adapters/access/key-source.js';
import { LocalIssuer } from '../../../dev/local-issuer/local-issuer.js';
import { issuerAnswer } from '../../../dev/local-issuer/routes.js';

const ISSUER = 'http://local-issuer.localhost';
const AUDIENCE = 'nightwatch-console-local';
const NOW = new Date(Date.UTC(2026, 10, 7));

function verifierFor(issuer: LocalIssuer): AccessSignInVerifier {
  return new AccessSignInVerifier({ keys: localKeySource({ [ISSUER]: issuer.jwks }), clock: { now: () => NOW } });
}

describe('local issuer routes', () => {
  it('publishes its public keys at the Access certs path', async () => {
    const issuer = await LocalIssuer.create(ISSUER);
    const answer = await issuerAnswer(new Request(`${ISSUER}/cdn-cgi/access/certs`), { issuer, now: NOW });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(issuer.jwks);
  });

  it('mints an Assertion for the email and audience asked, which the Access verifier accepts', async () => {
    const issuer = await LocalIssuer.create(ISSUER);
    const answer = await issuerAnswer(new Request(`${ISSUER}/dev/sign-in?email=ada@example.com&aud=${AUDIENCE}`), { issuer, now: NOW });
    expect(answer.status).toBe(200);
    const { assertion } = (await answer.json()) as { assertion: string };
    const signIn = await verifierFor(issuer).verify(assertion, [{ issuer: ISSUER, audiences: [AUDIENCE] }]);
    expect(signIn).toMatchObject({ email: 'ada@example.com', issuer: ISSUER, audience: AUDIENCE });
  });

  it('refuses a sign-in with no email or no audience, and answers 404 elsewhere', async () => {
    const issuer = await LocalIssuer.create(ISSUER);
    expect((await issuerAnswer(new Request(`${ISSUER}/dev/sign-in?aud=${AUDIENCE}`), { issuer, now: NOW })).status).toBe(400);
    expect((await issuerAnswer(new Request(`${ISSUER}/dev/sign-in?email=a@b.c`), { issuer, now: NOW })).status).toBe(400);
    expect((await issuerAnswer(new Request(`${ISSUER}/other`), { issuer, now: NOW })).status).toBe(404);
  });

  it('a restored issuer signs with the saved key pair', async () => {
    const original = await LocalIssuer.create(ISSUER);
    const restored = await LocalIssuer.restore(ISSUER, await original.privateJwk());
    const assertion = await restored.mint({ email: 'ada@example.com', aud: AUDIENCE, ttlSeconds: 600, issuedAt: NOW });
    expect(restored.jwks).toEqual(original.jwks);
    expect(await verifierFor(original).verify(assertion, [{ issuer: ISSUER, audiences: [AUDIENCE] }])).toMatchObject({ email: 'ada@example.com' });
  });
});
