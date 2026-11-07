// ProjectConfigSource contract: the KV adapter and the in-memory fake answer
// the same Project config for a seeded Project, and null for an unknown one.
// KV alone holds raw text, so its refusal of a malformed entry is its own case.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { KvProjectConfigSource } from '../../../src/adapters/kv/kv-project-config-source.js';
import type { ProjectConfig } from '../../../src/domain/ingest/arrival.js';
import type { ProjectConfigSource } from '../../../src/ports/project-config-source.js';
import { FakeProjectConfigSource } from '../../_fakes/fake-project-config-source.js';

const config: ProjectConfig = {
  clientKeys: [
    { publicKey: 'k-live', active: true },
    { publicKey: 'k-off', active: false },
  ],
  allowedOrigins: ['https://*.example.com'],
  sizeLimits: { event: 1000, attachment: 5000, arrival: 8000 },
  inboundFilters: {
    browserExtensions: true,
    localhost: false,
    webCrawlers: true,
    releases: ['1.0.*'],
    messages: ['*ResizeObserver*'],
    addresses: ['10.0.0.0/8'],
  },
};

async function seededKv(configs: Record<string, ProjectConfig>): Promise<ProjectConfigSource> {
  for (const [projectId, value] of Object.entries(configs)) await env.PROJECT_CONFIG.put(projectId, JSON.stringify(value));
  return new KvProjectConfigSource(env.PROJECT_CONFIG);
}

describe.each<{ name: string; make: (configs: Record<string, ProjectConfig>) => Promise<ProjectConfigSource> }>([
  { name: 'FakeProjectConfigSource', make: async (configs) => new FakeProjectConfigSource(configs) },
  { name: 'KvProjectConfigSource', make: seededKv },
])('ProjectConfigSource contract -- $name', ({ make }) => {
  it('a seeded Project reads back its whole config', async () => {
    const projectId = crypto.randomUUID();
    const source = await make({ [projectId]: config });
    expect(await source.get(projectId)).toEqual(config);
  });

  it('an unknown Project reads as null', async () => {
    const source = await make({ [crypto.randomUUID()]: config });
    expect(await source.get(crypto.randomUUID())).toBeNull();
  });
});

describe('KvProjectConfigSource', () => {
  it('refuses a malformed entry loudly instead of reading it as an unknown Project', async () => {
    const projectId = crypto.randomUUID();
    await env.PROJECT_CONFIG.put(projectId, JSON.stringify({ clientKeys: 'not-a-list' }));
    await expect(new KvProjectConfigSource(env.PROJECT_CONFIG).get(projectId)).rejects.toThrow(projectId);
  });

  it('reads the Quotas carried beside the config, and none when the entry has none', async () => {
    const withQuotas = crypto.randomUUID();
    const without = crypto.randomUUID();
    await env.PROJECT_CONFIG.put(withQuotas, JSON.stringify({ ...config, quotas: { windowSeconds: 60, limits: { error: 5 } } }));
    await env.PROJECT_CONFIG.put(without, JSON.stringify(config));
    const source = new KvProjectConfigSource(env.PROJECT_CONFIG);
    expect(await source.quotas(withQuotas)).toEqual({ windowSeconds: 60, limits: { error: 5 } });
    expect(await source.quotas(without)).toBeNull();
    expect(await source.quotas(crypto.randomUUID())).toBeNull();
  });
});
