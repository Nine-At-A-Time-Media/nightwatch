/**
 * applyEmailReply -- the inbound-mail Worker's pass over one reply to an
 * issue notification email (design Behaviors: Reply by email; Unknown
 * replier; Alerts and notifications, Reply by email).
 *
 * The reply's To address must carry a Reply Token whose signature verifies
 * and which has not expired; its sender must be the address of the Member
 * the token names, still a Member of the Project. Only then does the
 * replier's own text -- quoted text dropped -- become their comment on the
 * Issue, private, through the ProjectDO use case addComment. Any other reply
 * is refused and nothing is posted. That the sender really sent it (the
 * mail's own authentication) is checked by the email adapter before this
 * runs. Ports: ControlStore, ProjectClient, Signer, Clock.
 */

import type { IssueChange } from '../../domain/issue/state.js';
import { replyText } from '../../domain/mail/quoted-text.js';
import {
  isFromAddress,
  isReplyTokenLive,
  parseReplyAddress,
  replyTokenOf,
  type InboundReply,
  type ReplyToken,
} from '../../domain/mail/reply-address.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { Signer } from '../../ports/signer.js';

export type ApplyEmailReplyDeps = { control: ControlStore; projects: ProjectClient; signer: Signer; clock: Clock };

// --- flow: the reply address ---

async function verifiedToken(to: string, signer: Signer): Promise<ReplyToken | null> {
  const signed = parseReplyAddress(to);
  if (signed === null || !(await signer.verify(signed))) return null;
  return replyTokenOf(signed.text);
}

// --- flow: the sender ---

async function isReplierTheMember(token: ReplyToken, from: string, control: ControlStore): Promise<boolean> {
  const address = await control.addressOf({ member: token.member });
  if (address === null || !isFromAddress({ from, address })) return false;
  return control.isProjectMember({ projectId: token.projectId, email: address });
}

// --- exports ---

export async function applyEmailReply(reply: InboundReply, deps: ApplyEmailReplyDeps): Promise<IssueChange[] | Refusal> {
  const token = await verifiedToken(reply.to, deps.signer);
  if (token === null) return refusal('unknown_reply_address');
  if (!isReplyTokenLive(token, deps.clock.now())) return refusal('reply_address_expired');
  if (!(await isReplierTheMember(token, reply.from, deps.control))) return refusal('unknown_replier');
  const text = replyText(reply.text);
  if (text === '') return refusal('empty_reply');
  return deps.projects.addComment(token.projectId, token.issueId, { text, shared: false }, { member: token.member });
}
