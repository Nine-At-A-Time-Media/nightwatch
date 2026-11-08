/**
 * D1ProjectConfigSource -- the ProjectConfigSource read straight from the
 * control plane's D1 database (architecture Seams: Ingest-side project
 * config, the D1 direct read). Each Project's entry is the JSON document in
 * `project_configs`, the same entry the console copies to KV. The local
 * stage's ingest Worker reads it here, so a Project seeded in D1 is live
 * with no copy step. Like the KV adapter it also serves the Project's Quotas
 * to the QuotaGate adapter. A missing row is an unknown Project; a malformed
 * entry fails loudly.
 */

import type { ProjectConfig } from '../../domain/ingest/arrival.js';
import type { ProjectConfigSource } from '../../ports/project-config-source.js';
import { configOf, parseEntry, type ProjectEntry, type ProjectQuotas } from '../project-config/project-entry.js';

const ENTRY = 'SELECT config FROM project_configs WHERE project_id = ?';

// --- exports ---

export class D1ProjectConfigSource implements ProjectConfigSource {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async get(projectId: string): Promise<ProjectConfig | null> {
    const entry = await this.#entry(projectId);
    return entry === null ? null : configOf(entry);
  }

  async quotas(projectId: string): Promise<ProjectQuotas | null> {
    return (await this.#entry(projectId))?.quotas ?? null;
  }

  async #entry(projectId: string): Promise<ProjectEntry | null> {
    const text = await this.#db.prepare(ENTRY).bind(projectId).first<string>('config');
    return text === null ? null : parseEntry({ projectId, text });
  }
}
