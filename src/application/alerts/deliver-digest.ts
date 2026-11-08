/**
 * deliverDigest -- DigestDO's alarm: send a due Digest as one email (design
 * Behaviors: Digest gathers; Alerts and notifications, Digest). A Digest is
 * sent no sooner than its due time by the DigestPolicy, which also keeps it
 * no later than the Digest Maximum Delay after its first item. Returns what
 * DigestDO keeps: the Digest unchanged when it is not due, empty, or its
 * email was not accepted, so the next alarm tries again; an empty Digest
 * once it was sent. Ports: Mailer, Clock.
 */

import { digestMailOf } from '../../domain/alerts/alert-message.js';
import { emptyDigest, isDigestDue, type Digest, type DigestPolicy } from '../../domain/alerts/digest.js';
import type { Clock } from '../../ports/clock.js';
import type { Mailer } from '../../ports/mailer.js';

export type DeliverDigestDeps = { mailer: Mailer; clock: Clock; policy: DigestPolicy };

// --- exports ---

export async function deliverDigest(digest: Digest, deps: DeliverDigestDeps): Promise<Digest> {
  if (!isDigestDue(digest, deps.policy, deps.clock.now())) return digest;
  const sent = await deps.mailer.send(digestMailOf(digest));
  return sent.ok ? emptyDigest({ ruleId: digest.ruleId, recipient: digest.recipient }) : digest;
}
