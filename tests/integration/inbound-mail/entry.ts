// The inbound-mail project's test entry (vitest.config.ts): the inbound-mail
// Worker as it ships, plus ProjectDO, which the core Worker hosts in a dev
// session.
export { default } from '../../../src/workers/inbound-mail/index.js';
export { ProjectDO } from '../../../src/workers/core/project-do.js';
