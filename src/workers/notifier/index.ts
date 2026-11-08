/**
 * The notifier Worker's entry point (architecture Mechanism, Alerts and
 * notifications): the `effects` queue consumer. Each message is parsed and
 * handed to one step (steps.ts), then acknowledged on its own, or retried on
 * its own when the step fails; a message that keeps failing, or is not an
 * effect message at all, ends in the dead-letter queue once its retries are
 * spent. It also hosts DigestDO.
 */

import { parseEffectMessage } from '../../adapters/queues/queue-effect-queue.js';
import { notifierRuntime, type NotifierBindings, type NotifierRuntime } from './deps.js';
import { handleEffectMessage } from './steps.js';

export { DigestDO } from './digest-do.js';

// --- helpers ---

function logFailure(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event: 'notifier.message_failed', ...fields }));
}

// --- entry ---

async function settle(message: Message, runtime: NotifierRuntime): Promise<void> {
  const effect = parseEffectMessage(message.body);
  if (effect === null) {
    logFailure({ messageId: message.id, reason: 'not-an-effect-message' });
    message.retry();
    return;
  }
  try {
    await handleEffectMessage(effect, runtime);
    message.ack();
  } catch (error) {
    logFailure({
      messageId: message.id,
      step: effect.step ?? null,
      projectId: effect.projectId,
      issueId: effect.change.issueId,
      error: String(error),
    });
    message.retry();
  }
}

export default {
  async queue(batch, env): Promise<void> {
    const runtime = notifierRuntime(env);
    for (const message of batch.messages) await settle(message, runtime);
  },
} satisfies ExportedHandler<NotifierBindings>;
