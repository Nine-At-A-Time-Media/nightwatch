// Shared builders for the Releases use-case tests: one Organization with one
// Project, and Access Tokens kept the way the console keeps them -- only the
// hash of each token, with its record.
import { tokenBytes, type AccessToken, type AccessTokenRecord, type Scope } from '../../../../src/domain/tenancy/access-token.js';
import { FakeBlobStore } from '../../../_fakes/fake-blob-store.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { DAY, T0 } from '../../domain/issue/fixtures.js';

export { DAY, T0 };

export const ORG = 'org-1';
export const OTHER_ORG = 'org-2';
export const PROJECT = 'project-1';

export function world() {
  const control = new FakeControlStore();
  control.addProject(ORG, PROJECT);
  return { control, blobs: new FakeBlobStore(), clock: new FakeClock(T0), ids: new FakeIds('id') };
}

export type World = ReturnType<typeof world>;

/** Keeps a token as the console would: its hash and record only. Returns the token to present. */
export async function issueToken(
  w: World,
  token: AccessToken,
  record: Partial<AccessTokenRecord> & { scopes: readonly Scope[] },
): Promise<AccessToken> {
  const hash = await w.ids.hashContent(tokenBytes(token));
  await w.control.putAccessToken(hash, { organizationId: ORG, expiresAt: null, revoked: false, ...record });
  return token;
}
