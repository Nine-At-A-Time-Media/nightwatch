/**
 * The Project config entry -- the one JSON document that holds what ingest
 * reads about a Project (Client Keys, origins, size limits, Inbound Filters)
 * and its Quotas. The console writes it to D1 and copies it to KV
 * (architecture, Mechanism: Ingest); both ProjectConfigSource adapters parse
 * it here. A malformed entry is an operator error and fails loudly, never
 * reading as an unknown Project.
 */

import { z } from 'zod';
import type { ProjectConfig } from '../../domain/ingest/arrival.js';
import type { DataCategory } from '../../domain/protocol/retry-advice.js';

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

export type ProjectEntry = z.infer<typeof ProjectEntry>;

// --- helpers ---

export function parseEntry({ projectId, text }: { projectId: string; text: string }): ProjectEntry {
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

export function configOf(entry: ProjectEntry): ProjectConfig {
  return {
    clientKeys: entry.clientKeys,
    allowedOrigins: entry.allowedOrigins,
    sizeLimits: entry.sizeLimits,
    inboundFilters: entry.inboundFilters,
  };
}
