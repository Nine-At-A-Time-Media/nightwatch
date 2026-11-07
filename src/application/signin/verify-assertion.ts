/**
 * verifyAssertion -- turns an Assertion presented to one Organization into
 * a Sign-in, or a Refusal (design Tenancy and access, Sign-in and Trusted
 * sign-in; architecture Key Decisions A15: the use case verifies, through
 * SignInVerifier). Only the issuers that Organization trusts count; an
 * absent Assertion identifies nobody. Ports: SignInVerifier, ControlStore.
 */

import type { OrganizationId } from '../../domain/ids.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { Assertion, SignIn } from '../../domain/signin/sign-in.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';

export type VerifyAssertionDeps = { verifier: SignInVerifier; control: ControlStore };

// --- exports ---

export async function verifyAssertion(
  organizationId: OrganizationId,
  assertion: Assertion | null,
  deps: VerifyAssertionDeps,
): Promise<SignIn | Refusal> {
  if (assertion === null) return refusal('unsigned');
  return deps.verifier.verify(assertion, await deps.control.trustedIssuers(organizationId));
}
