/**
 * The inbound-mail Email Worker's entry point (architecture Mechanism, Alerts
 * and notifications; Security mitigations: Forged email replies). Each
 * delivered message is parsed and its authentication checked by the email
 * adapter, then handed to applyEmailReply. A message that is not an
 * acceptable reply is rejected back to its sender with a generic reason;
 * why is logged, never the message or its addresses.
 */

import { applyEmailReply } from '../../application/alerts/apply-email-reply.js';
import { inboundReplyOf } from '../../adapters/email/inbound-reply.js';
import { isRefusal } from '../../domain/refusal.js';
import { inboundMailDeps, type InboundMailBindings } from './deps.js';

const REJECTED = 'This address does not accept this message.';

// --- helpers ---

function reject(message: ForwardableEmailMessage, reason: string): void {
  console.warn(JSON.stringify({ event: 'inbound_mail.rejected', reason }));
  message.setReject(REJECTED);
}

// --- entry ---

export default {
  async email(message, env): Promise<void> {
    const deps = inboundMailDeps(env);
    const reply = await inboundReplyOf({ to: message.to, raw: message.raw });
    if (isRefusal(reply)) return reject(message, reply.refusal);
    const applied = await applyEmailReply(reply, deps);
    if (isRefusal(applied)) reject(message, applied.refusal);
  },
} satisfies ExportedHandler<InboundMailBindings>;
