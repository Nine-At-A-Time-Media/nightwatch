/**
 * The scheduler's run -- what one Cron Trigger does (architecture Mechanism:
 * Retention, archive and usage). It walks every Organization's Projects in
 * the ControlStore and has each Project's ProjectDO run enforceRetention,
 * which also sets the Project's sweep alarm again if it was lost; then it
 * runs compareUsage. One Project failing is logged and does not stop the
 * others, nor the usage comparison.
 */

import { compareUsage } from '../../application/operating/compare-usage.js';
import type { ProjectId } from '../../domain/ids.js';
import type { PlatformUsage } from '../../domain/operating/platform-usage.js';
import type { Expiry } from '../../domain/retention/retention.js';
import type { SchedulerRuntime } from './deps.js';

/** What one run did: each Project's Expiry, the Projects that failed, and Platform Usage as compared. */
export type SchedulerRun = {
  readonly expiries: ReadonlyMap<ProjectId, Expiry>;
  readonly failedProjects: readonly ProjectId[];
  readonly usage: readonly PlatformUsage[];
};

// --- flow ---

async function allProjects(r: SchedulerRuntime): Promise<ProjectId[]> {
  const projects: ProjectId[] = [];
  for (const organizationId of await r.control.organizations()) projects.push(...(await r.control.projectsOf(organizationId)));
  return projects;
}

async function retainOne(r: SchedulerRuntime, projectId: ProjectId): Promise<Expiry | null> {
  try {
    return await r.projects.enforceRetention(projectId, r.retention);
  } catch (error) {
    console.error(JSON.stringify({ event: 'scheduler.retention-failed', projectId, error: String(error) }));
    return null;
  }
}

// --- exports ---

export async function runScheduled(r: SchedulerRuntime): Promise<SchedulerRun> {
  const expiries = new Map<ProjectId, Expiry>();
  const failedProjects: ProjectId[] = [];
  for (const projectId of await allProjects(r)) {
    const expiry = await retainOne(r, projectId);
    if (expiry === null) failedProjects.push(projectId);
    else expiries.set(projectId, expiry);
  }
  const usage = await compareUsage({ usage: r.usage, channels: r.channels, clock: r.clock, limits: r.limits, operator: r.operator });
  return { expiries, failedProjects, usage };
}
