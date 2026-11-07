/**
 * The processor Worker's entry points (architecture, Mechanism: Stream
 * consumption and processing). It hosts StreamPumpDO. The Cron Trigger kicks
 * every pump, a safety net that starts a pump or restarts one whose alarm
 * chain broke; locally `pnpm dev:tick` fires it. It serves no HTTP route.
 */

import { pumpPlan } from './deps.js';
import { pumpNames } from './pump-steps.js';

export { StreamPumpDO } from './stream-pump-do.js';

// --- flow ---

async function kickAll(env: ProcessorEnv): Promise<number> {
  const names = pumpNames(pumpPlan(env).count);
  await Promise.all(names.map((name) => env.PUMP.getByName(name).kick(name)));
  return names.length;
}

// --- exports ---

export default {
  async fetch(): Promise<Response> {
    return Response.json({ detail: 'not-found' }, { status: 404 });
  },

  async scheduled(_controller, env): Promise<void> {
    await kickAll(env);
  },
} satisfies ExportedHandler<ProcessorEnv>;
