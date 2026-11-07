/**
 * viewFollowUp -- a signed-in person opens the Follow-up Page of a Report
 * Reference (design Behaviors: Follow-up Page shows status; Follow-up Page
 * refuses others; Unknown reference; Reports, Follow-up Page). Only the
 * Report's Reporter or a Member of its Project sees it; anyone else, and any
 * unknown or revoked reference, gets `not-found`. The page shows the Report
 * Status the Reporter was last shown, the shared Thread and the dates the
 * status changed, and nothing else about the Issue. Ports: SignInVerifier,
 * ControlStore, ProjectClient, Ids.
 */

import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { ReportReference } from '../../domain/report/reference.js';
import { canViewFollowUp } from '../../domain/report/report.js';
import { followUpView, lastShownStatus, type FollowUpView } from '../../domain/report/thread.js';
import type { Assertion } from '../../domain/signin/sign-in.js';
import { resolveReference, type ResolveReferenceDeps } from './resolve-reference.js';

export type ViewFollowUpDeps = ResolveReferenceDeps;

// --- exports ---

export async function viewFollowUp(reference: ReportReference, assertion: Assertion, deps: ViewFollowUpDeps): Promise<FollowUpView | Refusal> {
  const resolved = await resolveReference(reference, assertion, deps);
  if (isRefusal(resolved)) return resolved;
  const { entry, signIn, report } = resolved;
  const isMember = await deps.control.isProjectMember({ projectId: entry.projectId, email: signIn.email });
  if (!canViewFollowUp(signIn, report, isMember)) return refusal('not-found');
  const changes = await deps.projects.statusChangesOf(entry.projectId, report.id);
  const comments = await deps.projects.commentsOn(entry.projectId, report.issueId);
  return followUpView({ report, status: lastShownStatus(changes), changes, comments });
}
