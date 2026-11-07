/**
 * signInMember -- turns an Assertion presented to one Project into the
 * Member it identifies there, or a Refusal (design Tenancy and access,
 * Membership, Permission and Sign-in). The Assertion must verify against the
 * issuers the Project's Organization trusts, and its address must belong to
 * a Member with permission on the Project. Every use case that takes a
 * `Member` actor trusts it; the console's entry points call this first.
 * Ports: SignInVerifier, ControlStore.
 */

import type { ProjectId } from '../../domain/ids.js';
import type { Member } from '../../domain/issue/state.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { Assertion } from '../../domain/signin/sign-in.js';
import type { ControlStore } from '../../ports/control-store.js';
import { verifyAssertion, type VerifyAssertionDeps } from './verify-assertion.js';

export type SignInMemberDeps = VerifyAssertionDeps;

// --- predicates ---

function isAddressOf(address: string | null, email: string): boolean {
  return address !== null && address.toLowerCase() === email;
}

// --- flow ---

async function memberWithAddress(projectId: ProjectId, email: string, control: ControlStore): Promise<Member | null> {
  for (const member of await control.projectMembers(projectId)) {
    if (isAddressOf(await control.addressOf(member), email)) return member;
  }
  return null;
}

// --- exports ---

export async function signInMember(project: ProjectId, assertion: Assertion | null, deps: SignInMemberDeps): Promise<Member | Refusal> {
  const organizationId = await deps.control.organizationOf(project);
  if (organizationId === null) return refusal('not-found');
  const signIn = await verifyAssertion(organizationId, assertion, deps);
  if (isRefusal(signIn)) return refusal('unsigned');
  return (await memberWithAddress(project, signIn.email, deps.control)) ?? refusal('not_a_member');
}
