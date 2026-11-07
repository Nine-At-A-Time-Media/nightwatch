import { describe, expect, it } from 'vitest';
import { signInMember } from '../../../../src/application/signin/sign-in-member.js';
import type { SignIn } from '../../../../src/domain/signin/sign-in.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeSignInVerifier } from '../../../_fakes/sign-in-verifier.js';

const T0 = Date.UTC(2026, 10, 1);
const ORG = 'org-1';
const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';
const ISSUER = { issuer: 'https://acme.example', audiences: ['console'] };
const MIA = { member: 'member-mia' } as const;

function signInAs(email: string, issuer = ISSUER.issuer): SignIn {
  return { email, issuer, audience: 'console', expiresAt: new Date(T0 + 3_600_000) };
}

function world() {
  const control = new FakeControlStore();
  control.addProject(ORG, PROJECT);
  control.addProject(ORG, OTHER_PROJECT);
  control.addTrustedIssuer(ORG, ISSUER);
  control.addMember(PROJECT, MIA, { email: 'Mia@Acme.example' });
  const verifier = new FakeSignInVerifier({ clock: { now: () => new Date(T0) } });
  verifier.register('assertion:mia', signInAs('mia@acme.example'));
  verifier.register('assertion:eve', signInAs('eve@example.com'));
  verifier.register('assertion:mallory', signInAs('mia@acme.example', 'https://untrusted.example'));
  return { control, verifier };
}

describe('signInMember', () => {
  it('names the Member whose address the Assertion asserts, on a Project they have permission on', async () => {
    expect(await signInMember(PROJECT, 'assertion:mia', world())).toEqual(MIA);
  });

  it('refuses a person with no permission on the Project as not a member', async () => {
    const w = world();
    expect(await signInMember(PROJECT, 'assertion:eve', w)).toEqual({ refusal: 'not_a_member' });
    expect(await signInMember(OTHER_PROJECT, 'assertion:mia', w)).toEqual({ refusal: 'not_a_member' });
  });

  it('refuses an absent, unknown or untrusted Assertion as unsigned', async () => {
    const w = world();
    expect(await signInMember(PROJECT, null, w)).toEqual({ refusal: 'unsigned' });
    expect(await signInMember(PROJECT, 'assertion:forged', w)).toEqual({ refusal: 'unsigned' });
    expect(await signInMember(PROJECT, 'assertion:mallory', w)).toEqual({ refusal: 'unsigned' });
  });

  it('refuses an unknown Project as not found', async () => {
    expect(await signInMember('project-unknown', 'assertion:mia', world())).toEqual({ refusal: 'not-found' });
  });
});
