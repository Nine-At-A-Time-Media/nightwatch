/**
 * replyAsReporter -- a Reporter replies in their Report's Thread from its
 * Follow-up Page (design Behaviors: Reporter reply reaches team; Reports,
 * Thread). Only the Report's own Reporter replies this way; anyone else, and
 * any unknown or revoked reference, gets `not-found`. The reply is saved on
 * the Report's Issue through ProjectClient and its `comment` change is
 * enqueued, which carries the Comment's id and no contact detail, so a
 * tracker mirror of it has none to leak. Ports: SignInVerifier,
 * ControlStore, ProjectClient, EffectQueue, Ids, Clock.
 */

import type { IssueChange } from '../../domain/issue/state.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { ReportReference } from '../../domain/report/reference.js';
import { canViewFollowUp } from '../../domain/report/report.js';
import type { ReporterComment } from '../../domain/report/thread.js';
import type { Assertion } from '../../domain/signin/sign-in.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import { resolveReference, type ResolveReferenceDeps } from './resolve-reference.js';

export type ReplyAsReporterDeps = ResolveReferenceDeps & { effects: EffectQueue; clock: Clock };

/** What a Reporter writes; who wrote it and on which Report come from the Sign-in and the reference. */
export type ReplyDraft = Pick<ReporterComment, 'text'>;

// --- predicates ---

function isBlank(text: string): boolean {
  return text.trim() === '';
}

// --- exports ---

export async function replyAsReporter(
  reference: ReportReference,
  comment: ReplyDraft,
  assertion: Assertion,
  deps: ReplyAsReporterDeps,
): Promise<IssueChange[] | Refusal> {
  const resolved = await resolveReference(reference, assertion, deps);
  if (isRefusal(resolved)) return resolved;
  if (!canViewFollowUp(resolved.signIn, resolved.report, false)) return refusal('not-found');
  if (isBlank(comment.text)) return refusal('empty-message');
  const reply: ReporterComment = {
    id: deps.ids.newId(),
    author: { report: resolved.report.id },
    shared: true,
    text: comment.text,
    at: deps.clock.now(),
  };
  const changes = await deps.projects.recordReply(resolved.entry.projectId, reply);
  if (!isRefusal(changes)) await deps.effects.enqueue(changes);
  return changes;
}
