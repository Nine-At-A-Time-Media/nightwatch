import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { checkClaims, trustedIssuerFor, type TrustedIssuer } from '../../../../src/domain/signin/sign-in.js';

const ISSUER = 'https://acme.cloudflareaccess.com';
const AUDIENCE = 'aud-console';
const NOW = new Date('2026-11-07T12:00:00Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const TRUSTED: readonly TrustedIssuer[] = [{ issuer: ISSUER, audiences: ['aud-widget', AUDIENCE] }];

function claimsFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { iss: ISSUER, aud: [AUDIENCE], email: 'Ada@Example.COM', exp: NOW_SECONDS + 60, ...overrides };
}

describe('Trusted sign-in', () => {
  it('yields a Sign-in naming the lowercased email, issuer, matched audience and expiry', () => {
    expect(checkClaims(claimsFor(), TRUSTED, NOW)).toEqual({
      email: 'ada@example.com',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresAt: new Date((NOW_SECONDS + 60) * 1000),
    });
  });

  it('accepts an audience given as a single string', () => {
    expect(checkClaims(claimsFor({ aud: 'aud-widget' }), TRUSTED, NOW)).toMatchObject({ audience: 'aud-widget' });
  });

  it('refuses an assertion from an issuer the Organization does not trust', () => {
    expect(checkClaims(claimsFor({ iss: 'https://evil.cloudflareaccess.com' }), TRUSTED, NOW)).toEqual({ refusal: 'untrusted-issuer' });
    expect(checkClaims(claimsFor({ iss: undefined }), TRUSTED, NOW)).toEqual({ refusal: 'untrusted-issuer' });
  });

  it('refuses an audience the trusted issuer was not named for', () => {
    expect(checkClaims(claimsFor({ aud: ['aud-other'] }), TRUSTED, NOW)).toEqual({ refusal: 'wrong-audience' });
    expect(checkClaims(claimsFor({ aud: undefined }), TRUSTED, NOW)).toEqual({ refusal: 'wrong-audience' });
  });

  it('refuses an audience trusted only for a different issuer', () => {
    const trusted = [...TRUSTED, { issuer: 'https://other.cloudflareaccess.com', audiences: ['aud-other'] }];
    expect(checkClaims(claimsFor({ aud: ['aud-other'] }), trusted, NOW)).toEqual({ refusal: 'wrong-audience' });
  });

  it('refuses an assertion at or past its expiry, or with none', () => {
    expect(checkClaims(claimsFor({ exp: NOW_SECONDS }), TRUSTED, NOW)).toEqual({ refusal: 'expired' });
    expect(checkClaims(claimsFor({ exp: NOW_SECONDS - 1 }), TRUSTED, NOW)).toEqual({ refusal: 'expired' });
    expect(checkClaims(claimsFor({ exp: undefined }), TRUSTED, NOW)).toEqual({ refusal: 'expired' });
    expect(checkClaims(claimsFor({ exp: 'soon' }), TRUSTED, NOW)).toEqual({ refusal: 'expired' });
  });

  it('refuses an assertion that names no email address', () => {
    for (const email of [undefined, '', '   ', 'no-at-sign', 42]) {
      expect(checkClaims(claimsFor({ email }), TRUSTED, NOW)).toEqual({ refusal: 'missing-email' });
    }
  });

  it('finds the trusted issuer an assertion names, and nothing for any other', () => {
    expect(trustedIssuerFor(ISSUER, TRUSTED)).toEqual(TRUSTED[0]);
    expect(trustedIssuerFor('https://evil.cloudflareaccess.com', TRUSTED)).toBeNull();
    expect(trustedIssuerFor(undefined, TRUSTED)).toBeNull();
  });

  it('property: any issuer not in the trusted list identifies nobody', () => {
    fc.assert(
      fc.property(
        fc.string().filter((issuer) => issuer !== ISSUER),
        (issuer) => {
          expect(checkClaims(claimsFor({ iss: issuer }), TRUSTED, NOW)).toEqual({ refusal: 'untrusted-issuer' });
        },
      ),
    );
  });

  it('property: a trusted Sign-in always carries a lowercase email that was asserted', () => {
    fc.assert(
      fc.property(fc.emailAddress(), fc.integer({ min: 1, max: 86_400 }), (email, ttl) => {
        const result = checkClaims(claimsFor({ email: email.toUpperCase(), exp: NOW_SECONDS + ttl }), TRUSTED, NOW);
        expect(isRefusal(result)).toBe(false);
        expect(result).toMatchObject({ email: email.toLowerCase() });
      }),
    );
  });
});
