/**
 * The github Worker's entry point (architecture Mechanism, Code and GitHub;
 * Security mitigations: Forged webhooks). POST /webhooks/github is verified
 * against the webhook secret before any of it is parsed: a bad or missing
 * signature is 401. A verified webhook is parsed, mapped and applied
 * (steps.ts) and answered 202, including one Nightwatch does not act on. A
 * failure while applying is 500, so GitHub delivers it again.
 */

import { verifyWebhook } from '../../adapters/github/webhook.js';
import { isRefusal } from '../../domain/refusal.js';
import { githubRuntime, isGitHubStageReady, type GitHubWorkerBindings } from './deps.js';
import { applyWebhook } from './steps.js';

const WEBHOOK_PATH = '/webhooks/github';
const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';

// --- helpers ---

function answer({ status, detail }: { status: number; detail: string }): Response {
  return Response.json({ detail }, { status });
}

function payloadOf(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

// --- entry ---

async function handle(request: Request, env: GitHubWorkerBindings): Promise<Response> {
  if (!isGitHubStageReady(env)) return answer({ status: 500, detail: 'stage-has-no-adapters' });
  if (new URL(request.url).pathname !== WEBHOOK_PATH) return answer({ status: 404, detail: 'not-found' });
  if (request.method !== 'POST') return answer({ status: 405, detail: 'method-not-allowed' });
  const runtime = githubRuntime(env);
  const body = new Uint8Array(await request.arrayBuffer());
  const verified = await verifyWebhook(runtime.webhookSecret, body, request.headers.get(SIGNATURE_HEADER));
  if (isRefusal(verified)) return answer({ status: 401, detail: verified.refusal });
  const applied = await applyWebhook({ eventName: request.headers.get(EVENT_HEADER) ?? '', payload: payloadOf(body) }, runtime);
  return Response.json(applied, { status: 202 });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'github.webhook_failed', error: String(error) }));
      return answer({ status: 500, detail: 'internal-error' });
    }
  },
} satisfies ExportedHandler<GitHubWorkerBindings>;
