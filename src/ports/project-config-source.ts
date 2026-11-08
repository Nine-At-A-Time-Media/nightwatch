/**
 * ProjectConfigSource -- the seam for ingest-side Project config (Client Keys,
 * origins, size limits, Inbound Filters). Null when the Project is unknown.
 */

import type { ProjectConfig } from '../domain/ingest/arrival.js';

export interface ProjectConfigSource {
  get(projectId: string): Promise<ProjectConfig | null>;
}
