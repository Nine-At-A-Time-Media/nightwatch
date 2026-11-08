// The github project's test entry (vitest.config.ts): the github Worker as it
// ships, plus ProjectDO, which the core Worker hosts in a dev session, and the
// local fake GitHub as a named entrypoint, which sends its webhooks back to
// this Worker.
export { default } from '../../../src/workers/github/index.js';
export { ProjectDO } from '../../../src/workers/core/project-do.js';
export { FakeGitHubWorker } from '../../../dev/fake-github/index.js';
