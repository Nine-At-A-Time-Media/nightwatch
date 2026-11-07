// The notifier project's test entry (vitest.config.ts): the notifier Worker as
// it ships, plus ProjectDO, which the core Worker hosts in a dev session, and
// the local fake GitHub as a named entrypoint the Worker's GITHUB_API reaches.
export { default, DigestDO } from '../../../src/workers/notifier/index.js';
export { ProjectDO } from '../../../src/workers/core/project-do.js';
export { FakeGitHubWorker } from '../../../dev/fake-github/index.js';
