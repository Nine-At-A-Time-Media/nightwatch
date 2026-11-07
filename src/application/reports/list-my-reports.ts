/**
 * listMyReports -- a signed-in reporter lists their own Reports (design
 * Behaviors: My reports; Reports, My reports). The request names no
 * Organization: the Assertion identifies the reporter only in the
 * Organizations whose trusted issuers verify it, and the list holds their
 * Reports there and nobody else's. Each entry carries the Report Status they
 * were last shown and a Report Reference minted for this listing, since
 * only hashes of earlier references are kept. Ports: SignInVerifier,
 * ControlStore, ProjectClient, Ids.
 */

import type { OrganizationId } from '../../domain/ids.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { ReportList, ReportListEntry } from '../../domain/report/filing.js';
import type { Report } from '../../domain/report/report.js';
import { lastShownStatus } from '../../domain/report/thread.js';
import type { Assertion } from '../../domain/signin/sign-in.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import { verifyAssertion } from '../signin/verify-assertion.js';
import { mintReference } from './mint-reference.js';

export type ListMyReportsDeps = { verifier: SignInVerifier; control: ControlStore; projects: ProjectClient; ids: Ids };

// --- flow ---

async function entryOf(organizationId: OrganizationId, report: Report, deps: ListMyReportsDeps): Promise<ReportListEntry> {
  const { projectId, id: reportId } = report;
  const minted = await mintReference({ organizationId, projectId, reportId }, deps);
  const status = lastShownStatus(await deps.projects.statusChangesOf(projectId, reportId));
  return { organizationId, projectId, reportId, reference: minted.reference, message: report.message, filedAt: report.filedAt, status };
}

async function listIn(organizationId: OrganizationId, email: string, deps: ListMyReportsDeps): Promise<ReportListEntry[]> {
  const entries: ReportListEntry[] = [];
  for (const projectId of await deps.control.projectsOf(organizationId)) {
    for (const report of await deps.projects.reportsBy(projectId, { email })) entries.push(await entryOf(organizationId, report, deps));
  }
  return entries;
}

// --- exports ---

export async function listMyReports(assertion: Assertion, deps: ListMyReportsDeps): Promise<ReportList | Refusal> {
  const reports: ReportListEntry[] = [];
  let signedIn = false;
  for (const organizationId of await deps.control.organizations()) {
    const signIn = await verifyAssertion(organizationId, assertion, deps);
    if (isRefusal(signIn)) continue;
    signedIn = true;
    reports.push(...(await listIn(organizationId, signIn.email, deps)));
  }
  return signedIn ? { reports } : refusal('unsigned');
}
