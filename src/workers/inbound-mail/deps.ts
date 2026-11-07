/**
 * The inbound-mail Worker's wiring: the one place that names the concrete
 * adapter behind each port applyEmailReply takes, and reads the Reply Token
 * secret from its environment. Only the local stage has its adapters; any
 * other stage is refused rather than silently given a stand-in.
 */

import type { ApplyEmailReplyDeps } from '../../application/alerts/apply-email-reply.js';
import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { DurableProjectClient, type ProjectNamespace } from '../../adapters/do/durable-project-client.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { HmacSigner } from '../../adapters/webcrypto/hmac-signer.js';
import { requireLocalStage, secretSetting } from '../shared/settings.js';

/** The Worker's bindings with its secret, and ProjectDO's namespace as the client uses it. */
export type InboundMailBindings = Omit<InboundMailEnv, 'PROJECT'> & {
  readonly PROJECT: ProjectNamespace;
  /** Worker secret: verifies Reply Tokens; the notifier signs with the same. */
  readonly REPLY_TOKEN_SECRET?: string;
};

// --- wiring ---

export function inboundMailDeps(env: InboundMailBindings): ApplyEmailReplyDeps {
  requireLocalStage({ worker: 'inbound-mail', stage: env.STAGE });
  return {
    control: new D1ControlStore(env.CONTROL),
    projects: new DurableProjectClient({ namespace: env.PROJECT }),
    signer: new HmacSigner(secretSetting({ name: 'REPLY_TOKEN_SECRET', value: env.REPLY_TOKEN_SECRET })),
    clock: new SystemClock(),
  };
}
