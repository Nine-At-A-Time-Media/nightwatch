/**
 * KvProjectConfigSource -- the ProjectConfigSource over a KV namespace. Each
 * Project's entry is one JSON document keyed by the Project id, written by
 * the console from D1 (architecture, Mechanism: Ingest). The entry also
 * carries the Project's Quotas, which the QuotaGate adapter reads through
 * `quotas`. A missing entry is an unknown Project; a malformed one is an
 * operator error and fails loudly, never reading as unknown.
 */

import type { ProjectConfig } from '../../domain/ingest/arrival.js';
import type { ProjectConfigSource } from '../../ports/project-config-source.js';
import { configOf, parseEntry, type ProjectEntry, type ProjectQuotas } from '../project-config/project-entry.js';

export type { ProjectQuotas } from '../project-config/project-entry.js';

// --- exports ---

export class KvProjectConfigSource implements ProjectConfigSource {
  readonly #kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.#kv = kv;
  }

  async get(projectId: string): Promise<ProjectConfig | null> {
    const entry = await this.#entry(projectId);
    return entry === null ? null : configOf(entry);
  }

  async quotas(projectId: string): Promise<ProjectQuotas | null> {
    return (await this.#entry(projectId))?.quotas ?? null;
  }

  async #entry(projectId: string): Promise<ProjectEntry | null> {
    const text = await this.#kv.get(projectId, 'text');
    return text === null ? null : parseEntry({ projectId, text });
  }
}
