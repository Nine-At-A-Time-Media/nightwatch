/**
 * Scopes, roles and Access Tokens (design Tenancy and access: Permission,
 * Machine access; Domain Language: Access Token, Organization Role;
 * architecture Security mitigations, Stolen Access Token).
 *
 * A Scope names one kind of API action. An Organization Role is a named set
 * of Scopes, and a Member's permission is the union of the roles they hold.
 * An Access Token belongs to one Organization and carries a fixed set of
 * Scopes; a CI token carries only `project:releases`, so it can upload
 * release artifacts and do nothing else. Tokens are kept at rest only as
 * hashes; the record kept under the hash says whether the token was revoked
 * and when, if ever, it expires. A grant never reaches past the token's
 * Organization.
 */

import type { OrganizationId } from '../ids.js';
import { refusal, type Refusal } from '../refusal.js';

export const SCOPES = ['org:read', 'org:write', 'project:read', 'project:write', 'project:releases', 'event:read', 'event:write'] as const;

export type Scope = (typeof SCOPES)[number];

/** The secret a caller presents; never kept at rest. */
export type AccessToken = string;

/** What is kept under a token's hash. `expiresAt` is epoch ms, or null for a token that never expires. */
export type AccessTokenRecord = {
  readonly organizationId: OrganizationId;
  readonly scopes: readonly Scope[];
  readonly expiresAt: number | null;
  readonly revoked: boolean;
};

/** Permission to act with one Scope within one Organization. */
export type Grant = { readonly organizationId: OrganizationId; readonly scope: Scope };

export type OrganizationRole = 'owner' | 'member';

export const CI_TOKEN_SCOPES: readonly Scope[] = ['project:releases'];

const ROLE_SCOPES: Readonly<Record<OrganizationRole, readonly Scope[]>> = {
  owner: SCOPES,
  member: ['org:read', 'project:read', 'project:releases', 'event:read', 'event:write'],
};

// --- predicates ---

export function isScope(text: string): text is Scope {
  return (SCOPES as readonly string[]).includes(text);
}

function isExpired(record: AccessTokenRecord, now: number): boolean {
  return record.expiresAt !== null && now >= record.expiresAt;
}

// --- exports ---

/** The Scopes a holder of these roles has: their union, in SCOPES order. */
export function scopesOfRoles(roles: readonly OrganizationRole[]): Scope[] {
  const held = new Set(roles.flatMap((role) => ROLE_SCOPES[role]));
  return SCOPES.filter((scope) => held.has(scope));
}

/** The bytes a presented token is hashed from. */
export function tokenBytes(token: AccessToken): Uint8Array {
  return new TextEncoder().encode(token);
}

/** Grants `scope` to the holder of the token kept as `record` at `now`, or refuses. */
export function grantFor(record: AccessTokenRecord | null, scope: Scope, now: number): Grant | Refusal {
  if (record === null) return refusal('unknown-token');
  if (record.revoked) return refusal('token-revoked');
  if (isExpired(record, now)) return refusal('token-expired');
  if (!record.scopes.includes(scope)) return refusal('scope-missing');
  return { organizationId: record.organizationId, scope };
}
