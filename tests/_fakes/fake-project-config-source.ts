// FakeProjectConfigSource -- ProjectConfigSource over an in-memory map of Project configs.
import type { ProjectConfig } from '../../src/domain/ingest/arrival.js';
import type { ProjectConfigSource } from '../../src/ports/project-config-source.js';

export class FakeProjectConfigSource implements ProjectConfigSource {
  readonly configs = new Map<string, ProjectConfig>();

  constructor(configs: Record<string, ProjectConfig> = {}) {
    for (const [projectId, config] of Object.entries(configs)) this.configs.set(projectId, config);
  }

  async get(projectId: string): Promise<ProjectConfig | null> {
    return this.configs.get(projectId) ?? null;
  }
}
