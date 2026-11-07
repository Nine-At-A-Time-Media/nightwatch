/**
 * The local fake GitHub Worker's entry point (dev/fake-github, started by
 * `pnpm dev`). Every request goes to fakeGitHubFetch. FakeGitHubWorker is the
 * same handler as a named entrypoint, so a test Worker can host the fake
 * beside the Worker under test and bind to it.
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import { fakeGitHubFetch, type FakeGitHubEnv } from './fake-github-worker.js';

export class FakeGitHubWorker extends WorkerEntrypoint<FakeGitHubEnv> {
  override fetch(request: Request): Promise<Response> {
    return fakeGitHubFetch(request, this.env);
  }
}

export default {
  fetch(request, env): Promise<Response> {
    return fakeGitHubFetch(request, env);
  },
} satisfies ExportedHandler<FakeGitHubEnv>;
