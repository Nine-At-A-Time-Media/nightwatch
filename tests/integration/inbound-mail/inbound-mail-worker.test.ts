// The inbound-mail Email Worker's email handler in workerd, over local D1 and
// ProjectDO, called with a constructed message as Email Routing would deliver
// it: a Member's authenticated reply to an issue email becomes their private
// comment on the Issue; any other message is rejected and posts nothing.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import { HmacSigner } from '../../../src/adapters/webcrypto/hmac-signer.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import { replyAddress, replyTokenText } from '../../../src/domain/mail/reply-address.js';
import type { InboundMailBindings } from '../../../src/workers/inbound-mail/deps.js';
import worker from '../../../src/workers/inbound-mail/index.js';
import { seedProject, type SeededProject } from '../control-seed.js';

const DAY = 86_400_000;
const PASSED = 'mx.cloudflare.example; spf=pass; dkim=pass; dmarc=pass header.from=example.test';

// --- harness ---

const bindings = () => env as unknown as InboundMailBindings;
const projects = () => new DurableProjectClient({ namespace: bindings().PROJECT });

type Delivered = ForwardableEmailMessage & { readonly rejected: string[] };

/** A message as Email Routing hands it to the Worker, recording any rejection. */
function delivered({ from, to, headers, text }: { from: string; to: string; headers: Record<string, string>; text: string }): Delivered {
  const lines = [
    ...Object.entries({ ...headers, From: from, To: to, 'Content-Type': 'text/plain; charset=utf-8' }).map(([k, v]) => `${k}: ${v}`),
    '',
    text,
  ];
  const bytes = new TextEncoder().encode(lines.join('\r\n'));
  const rejected: string[] = [];
  return {
    from,
    to,
    raw: new Blob([bytes]).stream(),
    headers: new Headers(headers),
    rawSize: bytes.length,
    rejected,
    setReject: (reason: string) => {
      rejected.push(reason);
    },
    forward: async () => ({ messageId: 'unused' }),
    reply: async () => ({ messageId: 'unused' }),
  } as unknown as Delivered;
}

function summary(eventId: string): EventSummary {
  return {
    eventId,
    at: Date.now(),
    release: null,
    environment: 'production',
    level: 'error',
    userKey: 'user-1',
    title: 'TypeError',
    culprit: null,
  };
}

async function issueWithReplyAddress(seeded: SeededProject): Promise<{ issueId: string; address: string }> {
  const assignment = await projects().assignEvent(seeded.projectId, summary(crypto.randomUUID()), [`fp-${crypto.randomUUID()}`]);
  if (!('issueId' in assignment)) throw new Error('no issue opened');
  const text = replyTokenText({
    projectId: seeded.projectId,
    issueId: assignment.issueId,
    member: seeded.member,
    expiresAt: Date.now() + DAY,
  });
  const signature = await new HmacSigner(env.REPLY_TOKEN_SECRET).sign(text);
  return { issueId: assignment.issueId, address: replyAddress({ text, signature, domain: 'reply.localhost' }) };
}

async function receive(message: Delivered): Promise<void> {
  await worker.email(message, bindings());
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe('inbound-mail email handler', () => {
  it("Reply by email -- Given a Member's authenticated reply to an issue email, When it arrives, Then their text becomes a private comment on the Issue", async () => {
    const seeded = await seedProject(env.CONTROL);
    const { issueId, address } = await issueWithReplyAddress(seeded);
    const message = delivered({
      from: seeded.email,
      to: address,
      headers: { 'Authentication-Results': PASSED, Subject: 'Re: TypeError' },
      text: 'Looking into it now.\r\n\r\nOn Monday Nightwatch wrote:\r\n> TypeError',
    });

    await receive(message);

    expect(message.rejected).toEqual([]);
    const comments = await projects().commentsOn(seeded.projectId, issueId);
    expect(comments.map((comment) => [comment.text, comment.shared, comment.author])).toEqual([
      ['Looking into it now.', false, { member: seeded.member }],
    ]);
  });

  it('Unknown replier -- Given a reply from an address that is not the Member the token names, When it arrives, Then it is rejected and nothing is posted', async () => {
    const seeded = await seedProject(env.CONTROL);
    const { issueId, address } = await issueWithReplyAddress(seeded);
    const message = delivered({
      from: 'mallory@example.test',
      to: address,
      headers: { 'Authentication-Results': PASSED },
      text: 'Close it.',
    });

    await receive(message);

    expect(message.rejected).toHaveLength(1);
    expect(await projects().commentsOn(seeded.projectId, issueId)).toEqual([]);
  });

  it("rejects a reply the receiving server did not authenticate, even from the Member's own address", async () => {
    const seeded = await seedProject(env.CONTROL);
    const { issueId, address } = await issueWithReplyAddress(seeded);
    const message = delivered({ from: seeded.email, to: address, headers: {}, text: 'Close it.' });

    await receive(message);

    expect(message.rejected).toHaveLength(1);
    expect(await projects().commentsOn(seeded.projectId, issueId)).toEqual([]);
  });

  it('rejects a message to an address that carries no valid Reply Token', async () => {
    const seeded = await seedProject(env.CONTROL);
    const { issueId } = await issueWithReplyAddress(seeded);
    const message = delivered({
      from: seeded.email,
      to: 'reply+forged.signature@reply.localhost',
      headers: { 'Authentication-Results': PASSED },
      text: 'hi',
    });

    await receive(message);

    expect(message.rejected).toHaveLength(1);
    expect(await projects().commentsOn(seeded.projectId, issueId)).toEqual([]);
  });
});
