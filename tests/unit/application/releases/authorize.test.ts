import { describe, expect, it } from 'vitest';
import { authorize } from '../../../../src/application/releases/authorize.js';
import { CI_TOKEN_SCOPES, scopesOfRoles, tokenBytes } from '../../../../src/domain/tenancy/access-token.js';
import { DAY, issueToken, ORG, OTHER_ORG, T0, world } from './world.js';

describe('authorize', () => {
  it('CI token cannot read: Given a CI token, When it asks for issues, Then it is refused', async () => {
    const w = world();
    const ci = await issueToken(w, 'nw_ci_secret', { scopes: CI_TOKEN_SCOPES });

    expect(await authorize(ci, 'event:read', w)).toEqual({ refusal: 'scope-missing' });
    expect(await authorize(ci, 'project:read', w)).toEqual({ refusal: 'scope-missing' });
    expect(await authorize(ci, 'project:releases', w)).toEqual({ organizationId: ORG, scope: 'project:releases' });
  });

  it('keeps no token at rest, only its hash', async () => {
    const w = world();
    await issueToken(w, 'nw_ci_secret', { scopes: CI_TOKEN_SCOPES });
    expect([...w.control.accessTokens.keys()]).toEqual([await w.ids.hashContent(tokenBytes('nw_ci_secret'))]);
    expect([...w.control.accessTokens.keys()].join()).not.toContain('nw_ci_secret');
  });

  it('refuses an unknown, revoked or expired token', async () => {
    const w = world();
    const revoked = await issueToken(w, 'revoked', { scopes: CI_TOKEN_SCOPES, revoked: true });
    const expiring = await issueToken(w, 'expiring', { scopes: CI_TOKEN_SCOPES, expiresAt: T0 + DAY });

    expect(await authorize('never-issued', 'project:releases', w)).toEqual({ refusal: 'unknown-token' });
    expect(await authorize(revoked, 'project:releases', w)).toEqual({ refusal: 'token-revoked' });
    expect(await authorize(expiring, 'project:releases', w)).toEqual({ organizationId: ORG, scope: 'project:releases' });
    w.clock.advance(DAY);
    expect(await authorize(expiring, 'project:releases', w)).toEqual({ refusal: 'token-expired' });
  });

  it("grants within the token's own Organization only", async () => {
    const w = world();
    const other = await issueToken(w, 'other-org', { organizationId: OTHER_ORG, scopes: scopesOfRoles(['owner']) });
    expect(await authorize(other, 'event:read', w)).toEqual({ organizationId: OTHER_ORG, scope: 'event:read' });
  });
});
