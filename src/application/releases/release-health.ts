/**
 * releaseHealth -- a Release's crash-free session and user rates in one
 * Environment (design Behaviors: Crash-free rate; Releases and monitors,
 * Release health). Reads the Project's Session totals through
 * ProjectClient and rates them in the release domain. Ports: ProjectClient.
 */

import type { ProjectId } from '../../domain/ids.js';
import { releaseHealthOf, type Environment, type ReleaseHealth } from '../../domain/release/health.js';
import type { Release } from '../../domain/release/ordering.js';
import type { ProjectClient } from '../../ports/project-client.js';

export type ReleaseHealthDeps = { projects: ProjectClient };

// --- exports ---

export async function releaseHealth(
  projectId: ProjectId,
  release: Release,
  environment: Environment,
  deps: ReleaseHealthDeps,
): Promise<ReleaseHealth> {
  const totals = await deps.projects.sessionTotals(projectId, { release, environment });
  return releaseHealthOf({ release, environment, ...totals });
}
