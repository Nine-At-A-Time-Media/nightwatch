import { describe, expect, it } from 'vitest';
import { applyEmailReply } from '../../../../src/application/alerts/apply-email-reply.js';
import { notifyFollowers } from '../../../../src/application/alerts/notify-followers.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import {
  DAY,
  EVE_EMAIL,
  HOUR,
  MAIL_SETTINGS,
  MIA,
  MIA_EMAIL,
  PROJECT,
  T0,
  followedIssue,
  notifyDeps,
  resolveIssue,
  world,
  type World,
} from './world.js';

const QUOTED_REPLY = ['Looking at it now -- the cart total is null.', '', 'On Sun, Nov 1, 2026 Nightwatch wrote:', '> Issue changed'].join(
  '\n',
);

/** Sends the issue notification email and returns Mia's Reply-To address. */
async function notifiedReplyTo(w: World): Promise<{ issueId: string; replyTo: string }> {
  const issueId = await followedIssue(w);
  w.clock.set(T0 + HOUR);
  await notifyFollowers(PROJECT, await resolveIssue(w, issueId), notifyDeps(w));
  const replyTo = w.mailer.sentTo(MIA_EMAIL)[0]?.headers['Reply-To'];
  if (!replyTo) throw new Error('no Reply-To');
  return { issueId, replyTo };
}

function replyDeps(w: World) {
  return { control: w.control, projects: w.projects, signer: w.signer, clock: w.clock };
}

describe('applyEmailReply', () => {
  it('Reply by email: Given an issue notification email, When a Member replies, Then the reply becomes their comment on the issue', async () => {
    const w = world();
    const { issueId, replyTo } = await notifiedReplyTo(w);
    w.clock.set(T0 + 2 * HOUR);

    const changes = await applyEmailReply({ to: replyTo, from: `Mia <${MIA_EMAIL.toUpperCase()}>`, text: QUOTED_REPLY }, replyDeps(w));

    expect(isRefusal(changes)).toBe(false);
    expect(changes).toEqual([expect.objectContaining({ issueId, kind: 'comment', actor: MIA })]);
    expect(await w.projects.commentsOn(PROJECT, issueId)).toEqual([
      { id: expect.any(String), author: MIA, shared: false, text: 'Looking at it now -- the cart total is null.', at: T0 + 2 * HOUR },
    ]);
    expect(w.effects.enqueued).toEqual(changes);
  });

  it('Unknown replier: Given an issue notification email, When an address that is not a Member replies, Then nothing is posted', async () => {
    const w = world();
    const { issueId, replyTo } = await notifiedReplyTo(w);

    expect(await applyEmailReply({ to: replyTo, from: EVE_EMAIL, text: 'me too' }, replyDeps(w))).toEqual({ refusal: 'unknown_replier' });
    expect(await w.projects.commentsOn(PROJECT, issueId)).toEqual([]);
  });

  it('Unknown replier: a reply to a forged, tampered or expired address posts nothing', async () => {
    const w = world();
    const { issueId, replyTo } = await notifiedReplyTo(w);
    const tampered = replyTo.replace(/\.([A-Za-z0-9_-]+)@/, '.AAAA$1@');

    expect(await applyEmailReply({ to: 'support@acme.example', from: MIA_EMAIL, text: 'hi' }, replyDeps(w))).toEqual({
      refusal: 'unknown_reply_address',
    });
    expect(await applyEmailReply({ to: tampered, from: MIA_EMAIL, text: 'hi' }, replyDeps(w))).toEqual({
      refusal: 'unknown_reply_address',
    });
    w.clock.set(T0 + HOUR + MAIL_SETTINGS.replyLifetimeMs + DAY);
    expect(await applyEmailReply({ to: replyTo, from: MIA_EMAIL, text: 'hi' }, replyDeps(w))).toEqual({ refusal: 'reply_address_expired' });
    expect(await w.projects.commentsOn(PROJECT, issueId)).toEqual([]);
  });

  it('posts nothing for a reply that only quotes the notification', async () => {
    const w = world();
    const { replyTo } = await notifiedReplyTo(w);
    expect(await applyEmailReply({ to: replyTo, from: MIA_EMAIL, text: '> Issue changed' }, replyDeps(w))).toEqual({
      refusal: 'empty_reply',
    });
  });
});
