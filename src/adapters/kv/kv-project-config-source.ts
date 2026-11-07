/**
 * KvProjectConfigSource -- the ProjectConfigSource over a KV namespace. Each
 * Project's entry is one JSON document keyed by the Project id, written by
 * the console from D1 (architecture, Mechanism: Ingest). The entry also
 * carries the Project's Quotas, which the QuotaGate adapter reads through
 * `quotas`. A missing entry is an unknown Project; a malformed one is an
 * operator error and fails loudly, never reading as unknown.
 */

import { z } from 'zod';
import type { ProjectConfig } from '../../domain/ingest/arrival.js';
import type { DataCategory } from '../../domain/protocol/retry-advice.js';
import type { ProjectConfigSource } from '../../ports/project-config-source.js';

/** A Project's Quotas: a fixed window, and a limit per category within it. A category without a limit is unbounded. */
export type ProjectQuotas = {
  readonly windowSeconds: number;
  readonly limits: Readonly<Partial<Record<DataCategory, number>>>;
};

const CATEGORIES = [
  'default',
  'error',
  'security',
  'attachment',
  'session',
  'feedback',
  'monitor',
] as const satisfies readonly DataCategory[];

const count = z.number().int().nonnegative();

const ProjectEntry = z.object({
  clientKeys: z.array(z.object({ publicKey: z.string().min(1), active: z.boolean() })),
  allowedOrigins: z.array(z.string()),
  sizeLimits: z.object({ event: count, attachment: count, arrival: count }),
  inboundFilters: z.object({
    browserExtensions: z.boolean(),
    localhost: z.boolean(),
    webCrawlers: z.boolean(),
    releases: z.array(z.string()),
    messages: z.array(z.string()),
    addresses: z.array(z.string()),
  }),
  quotas: z.object({ windowSeconds: z.number().int().positive(), limits: z.partialRecord(z.enum(CATEGORIES), count) }).optional(),
});

type ProjectEntry = z.infer<typeof ProjectEntry>;

// --- helpers ---

function parseEntry({ projectId, text }: { projectId: string; text: string }): ProjectEntry {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`project config for ${projectId} is not JSON`);
  }
  const parsed = ProjectEntry.safeParse(json);
  if (!parsed.success) throw new Error(`project config for ${projectId} is malformed: ${parsed.error.message}`);
  return parsed.data;
}

function configOf(entry: ProjectEntry): ProjectConfig {
  return {
    clientKeys: entry.clientKeys,
    allowedOrigins: entry.allowedOrigins,
    sizeLimits: entry.sizeLimits,
    inboundFilters: entry.inboundFilters,
  };
}

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
