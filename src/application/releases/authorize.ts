/**
 * authorize -- whether a presented Access Token may act with one Scope
 * (design Behaviors: CI token cannot read; Tenancy and access, Machine
 * access). The token is hashed and its record looked up by that hash, since
 * only hashes are kept; the tenancy domain then grants or refuses. A CI
 * token carries only `project:releases`, so asking to read issues is
 * refused. Ports: ControlStore, Clock, Ids.
 */

import type { Refusal } from '../../domain/refusal.js';
import { grantFor, tokenBytes, type AccessToken, type Grant, type Scope } from '../../domain/tenancy/access-token.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';

export type AuthorizeDeps = { control: ControlStore; clock: Clock; ids: Ids };

// --- exports ---

export async function authorize(token: AccessToken, scope: Scope, deps: AuthorizeDeps): Promise<Grant | Refusal> {
  const hash = await deps.ids.hashContent(tokenBytes(token));
  const record = await deps.control.findAccessToken(hash);
  return grantFor(record, scope, deps.clock.now());
}
