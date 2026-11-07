// ProjectConfigSource contract: the KV adapter, the D1 adapter (the direct
// read the local stage uses) and the in-memory fake answer the same Project
// config for a seeded Project, and null for an unknown one. KV and D1 hold
// raw JSON, so their refusal of a malformed entry is their own case.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1ProjectConfigSource } from '../../../src/adapters/d1/d1-project-config-source.js';
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

/** Seeds D1 as the console writes it: the Organization, the Project, then its ingest config entry. */
async function seedD1Entry({ projectId, entry }: { projectId: string; entry: unknown }): Promise<void> {
  const organizationId = `org-${projectId}`;
  await env.CONTROL.prepare('INSERT INTO organizations (organization_id) VALUES (?)').bind(organizationId).run();
  await env.CONTROL.prepare('INSERT INTO projects (project_id, organization_id) VALUES (?, ?)').bind(projectId, organizationId).run();
  await env.CONTROL.prepare('INSERT INTO project_configs (project_id, config) VALUES (?, ?)').bind(projectId, JSON.stringify(entry)).run();
}

async function seededD1(configs: Record<string, ProjectConfig>): Promise<ProjectConfigSource> {
  for (const [projectId, entry] of Object.entries(configs)) await seedD1Entry({ projectId, entry });
  return new D1ProjectConfigSource(env.CONTROL);
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe.each<{ name: string; make: (configs: Record<string, ProjectConfig>) => Promise<ProjectConfigSource> }>([
  { name: 'FakeProjectConfigSource', make: async (configs) => new FakeProjectConfigSource(configs) },
  { name: 'KvProjectConfigSource', make: seededKv },
  { name: 'D1ProjectConfigSource', make: seededD1 },
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

describe('D1ProjectConfigSource', () => {
  it('refuses a malformed entry loudly instead of reading it as an unknown Project', async () => {
    const projectId = crypto.randomUUID();
    await seedD1Entry({ projectId, entry: { clientKeys: 'not-a-list' } });
    await expect(new D1ProjectConfigSource(env.CONTROL).get(projectId)).rejects.toThrow(projectId);
  });

  it('reads the Quotas carried beside the config, and none when the entry has none', async () => {
    const withQuotas = crypto.randomUUID();
    const without = crypto.randomUUID();
    await seedD1Entry({ projectId: withQuotas, entry: { ...config, quotas: { windowSeconds: 60, limits: { error: 5 } } } });
    await seedD1Entry({ projectId: without, entry: config });
    const source = new D1ProjectConfigSource(env.CONTROL);
    expect(await source.quotas(withQuotas)).toEqual({ windowSeconds: 60, limits: { error: 5 } });
    expect(await source.quotas(without)).toBeNull();
    expect(await source.quotas(crypto.randomUUID())).toBeNull();
  });
});
