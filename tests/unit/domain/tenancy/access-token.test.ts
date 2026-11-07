import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CI_TOKEN_SCOPES,
  grantFor,
  isScope,
  scopesOfRoles,
  SCOPES,
  tokenBytes,
  type AccessTokenRecord,
} from '../../../../src/domain/tenancy/access-token.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const NOW = Date.UTC(2026, 10, 1);

function record(overrides: Partial<AccessTokenRecord> = {}): AccessTokenRecord {
  return { organizationId: 'org-1', scopes: CI_TOKEN_SCOPES, expiresAt: null, revoked: false, ...overrides };
}

describe('grantFor', () => {
  it('grants a scope the token carries, within its Organization', () => {
    expect(grantFor(record(), 'project:releases', NOW)).toEqual({ organizationId: 'org-1', scope: 'project:releases' });
  });

  it('refuses an unknown, revoked or expired token, and a scope it does not carry', () => {
    expect(grantFor(null, 'project:releases', NOW)).toEqual({ refusal: 'unknown-token' });
    expect(grantFor(record({ revoked: true }), 'project:releases', NOW)).toEqual({ refusal: 'token-revoked' });
    expect(grantFor(record({ expiresAt: NOW }), 'project:releases', NOW)).toEqual({ refusal: 'token-expired' });
    expect(isRefusal(grantFor(record({ expiresAt: NOW + 1 }), 'project:releases', NOW))).toBe(false);
    expect(grantFor(record(), 'event:read', NOW)).toEqual({ refusal: 'scope-missing' });
  });

  it('gives a CI token only the release upload scope', () => {
    expect(CI_TOKEN_SCOPES).toEqual(['project:releases']);
  });

  it('grants exactly the scopes a live token carries', () => {
    fc.assert(
      fc.property(fc.subarray([...SCOPES]), fc.constantFrom(...SCOPES), (scopes, scope) => {
        expect(!isRefusal(grantFor(record({ scopes }), scope, NOW))).toBe(scopes.includes(scope));
      }),
    );
  });
});

describe('scopesOfRoles', () => {
  it('is the union of the roles held', () => {
    const member = scopesOfRoles(['member']);
    const owner = scopesOfRoles(['owner']);
    expect(member).toContain('event:read');
    expect(member).not.toContain('org:write');
    expect(scopesOfRoles(['member', 'owner'])).toEqual(owner);
    expect(owner).toEqual([...SCOPES]);
    expect(scopesOfRoles([])).toEqual([]);
  });
});

describe('isScope', () => {
  it('recognises only known scopes', () => {
    fc.assert(fc.property(fc.string(), (text) => expect(isScope(text)).toBe((SCOPES as readonly string[]).includes(text))));
    for (const scope of SCOPES) expect(isScope(scope)).toBe(true);
  });
});

describe('tokenBytes', () => {
  it('encodes a presented token as UTF-8, the same each time', () => {
    expect(tokenBytes('ab')).toEqual(new Uint8Array([97, 98]));
    fc.assert(fc.property(fc.string(), (token) => expect(tokenBytes(token)).toEqual(tokenBytes(token))));
  });
});
