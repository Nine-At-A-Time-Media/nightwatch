/**
 * eraseReporter -- an Organization owner erases a reporter's Reports and
 * contact details (design Behaviors: Erasure; Erasure reaches every store;
 * Retention and data handling, Erasure). In each Project of the owner's
 * Organization: every Report Reference of the reporter's Reports is revoked
 * and their subscription records dropped, so Follow-up Pages answer
 * not-found at once; the Reports are removed with their replies, shown
 * statuses and emptied Report issues; and their Attachments are deleted. A
 * pending Reporter Notification then finds no Report and sends nothing.
 * Every store that could not be erased is named in the Erasure, so the owner
 * is told when it is incomplete.
 *
 * Reaches the stores its ports reach: ControlStore, ProjectClient (the
 * Projects' issue state and History) and BlobStore.
 */

import type { OrganizationId, ProjectId } from '../../domain/ids.js';
import type { Member } from '../../domain/issue/state.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import { erasureOf, type Erasure } from '../../domain/report/erasure.js';
import type { Reporter } from '../../domain/report/report.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type EraseReporterDeps = { control: ControlStore; projects: ProjectClient; blobs: BlobStore };

type Tally = { reports: number; failed: string[] };

// --- flow ---

async function deleteBlob(key: string, blobs: BlobStore): Promise<boolean> {
  try {
    await blobs.delete(key);
    return true;
  } catch {
    return false;
  }
}

async function eraseInProject(projectId: ProjectId, reporter: Reporter, deps: EraseReporterDeps, tally: Tally): Promise<void> {
  for (const report of await deps.projects.reportsBy(projectId, reporter)) {
    if (!(await deps.control.forgetReport(report.id)).ok) tally.failed.push('control');
  }
  const erased = await deps.projects.eraseReports(projectId, reporter);
  tally.reports += erased.length;
  for (const key of erased.flatMap((report) => report.attachments)) {
    if (!(await deleteBlob(key, deps.blobs))) tally.failed.push('blobs');
  }
}

async function eraseInOrganization(organizationId: OrganizationId, reporter: Reporter, deps: EraseReporterDeps): Promise<Erasure> {
  const tally: Tally = { reports: 0, failed: [] };
  for (const projectId of await deps.control.projectsOf(organizationId)) await eraseInProject(projectId, reporter, deps, tally);
  return erasureOf(tally);
}

// --- exports ---

export async function eraseReporter(reporter: Reporter, actor: Member, deps: EraseReporterDeps): Promise<Erasure | Refusal> {
  const membership = await deps.control.membershipOf(actor);
  if (membership === null || membership.role !== 'owner') return refusal('not-allowed');
  return eraseInOrganization(membership.organizationId, reporter, deps);
}
