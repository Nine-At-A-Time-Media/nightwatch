/**
 * The core Worker's entry point (architecture, Module map: src/workers/core).
 * It hosts ProjectDO; other Workers reach a Project over the Durable Object
 * binding through ProjectClient, so its own fetch serves nothing.
 */

export { ProjectDO } from './project-do.js';

export default {
  async fetch(): Promise<Response> {
    return Response.json({ detail: 'not-found' }, { status: 404 });
  },
} satisfies ExportedHandler<CoreEnv>;
