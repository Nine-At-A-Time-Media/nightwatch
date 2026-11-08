/**
 * openReportForm -- a signed-in reporter opens the report form (design
 * Behaviors: Reporter not asked who they are; Reports, Identity). The
 * reporter's identity comes from their Sign-in against the issuers the
 * Project's Organization trusts; the form asks only for the message and the
 * optional screenshot and associated event. Ports: SignInVerifier,
 * ControlStore. The Project comes from the route that serves the form.
 */

import type { ProjectId } from '../../domain/ids.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import { reportForm, type ReportForm } from '../../domain/report/filing.js';
import type { Assertion } from '../../domain/signin/sign-in.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import { verifyAssertion } from '../signin/verify-assertion.js';

export type OpenReportFormDeps = { verifier: SignInVerifier; control: ControlStore };

// --- exports ---

export async function openReportForm(project: ProjectId, assertion: Assertion, deps: OpenReportFormDeps): Promise<ReportForm | Refusal> {
  const organizationId = await deps.control.organizationOf(project);
  if (organizationId === null) return refusal('not-found');
  const signIn = await verifyAssertion(organizationId, assertion, deps);
  return isRefusal(signIn) ? refusal('unsigned') : reportForm(signIn);
}
