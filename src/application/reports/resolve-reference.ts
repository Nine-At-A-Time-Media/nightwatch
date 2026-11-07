/**
 * resolveReference -- finds the Report a Report Reference names, for a
 * signed-in person (design Reports, Reference and Follow-up Page; Security
 * Considerations, a leaked Report Reference). A reference that is malformed,
 * unknown, revoked, or names a Report no longer held, and an Assertion the
 * Report's Organization does not trust, all answer the same `not-found`, so
 * the answer reveals nothing about which it was. Who may act on the Report
 * is the caller's rule. Ports: SignInVerifier, ControlStore, ProjectClient,
 * Ids.
 */

import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import { isWellFormedReference, type ReportReference } from '../../domain/report/reference.js';
import type { Report } from '../../domain/report/report.js';
import type { Assertion, SignIn } from '../../domain/signin/sign-in.js';
import type { ControlStore, ReferenceEntry } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import { verifyAssertion } from '../signin/verify-assertion.js';

export type ResolveReferenceDeps = { verifier: SignInVerifier; control: ControlStore; projects: ProjectClient; ids: Ids };

export type ResolvedReference = { readonly entry: ReferenceEntry; readonly signIn: SignIn; readonly report: Report };

const NOT_FOUND = refusal('not-found');

// --- exports ---

export async function resolveReference(
  reference: ReportReference,
  assertion: Assertion,
  deps: ResolveReferenceDeps,
): Promise<ResolvedReference | Refusal> {
  if (!isWellFormedReference(reference)) return NOT_FOUND;
  const entry = await deps.control.findReference(await deps.ids.hashReference(reference));
  if (entry === null) return NOT_FOUND;
  const signIn = await verifyAssertion(entry.organizationId, assertion, deps);
  if (isRefusal(signIn)) return NOT_FOUND;
  const report = await deps.projects.getReport(entry.projectId, entry.reportId);
  return report === null ? NOT_FOUND : { entry, signIn, report };
}
