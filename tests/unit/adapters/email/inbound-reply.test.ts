// inboundReplyOf: the email adapter's MIME parse of a reply delivered to the
// inbound-mail Worker. It yields the Inbound Reply applyEmailReply takes --
// the address the mail was delivered to, its From, and its plain text --
// and refuses a message whose own authentication says it was forged, or that
// names no sender.
import { describe, expect, it } from 'vitest';
import { inboundReplyOf } from '../../../../src/adapters/email/inbound-reply.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const TO = 'reply+abc.def@reply.example.test';

function raw(headers: Record<string, string>, body: string): Uint8Array {
  const lines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
  return new TextEncoder().encode([...lines, '', body].join('\r\n'));
}

const PLAIN = {
  From: 'Ada Lovelace <ada@example.test>',
  To: TO,
  Subject: 'Re: Issue resolved',
  'Content-Type': 'text/plain; charset=utf-8',
};

describe('inboundReplyOf', () => {
  it('reads the delivery address, the From address and the plain text of a reply', async () => {
    const reply = await inboundReplyOf({ to: TO, raw: raw(PLAIN, 'Still broken for me.\r\n\r\n> earlier text') });
    expect(reply).toEqual({ to: TO, from: 'ada@example.test', text: 'Still broken for me.\n\n> earlier text' });
  });

  it('reads the text part of a multipart reply', async () => {
    const multipart = raw(
      { ...PLAIN, 'Content-Type': 'multipart/alternative; boundary="b1"' },
      ['--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Plain words.', '--b1', 'Content-Type: text/html', '', '<p>Plain words.</p>', '--b1--'].join(
        '\r\n',
      ),
    );
    const reply = await inboundReplyOf({ to: TO, raw: multipart });
    expect(isRefusal(reply) ? reply : reply.text.trim()).toBe('Plain words.');
  });

  it('refuses a reply whose authentication results say DMARC failed', async () => {
    const forged = raw({ ...PLAIN, 'Authentication-Results': 'mx.example.test; spf=pass; dmarc=fail header.from=example.test' }, 'hi');
    expect(await inboundReplyOf({ to: TO, raw: forged })).toEqual({ refusal: 'mail_unauthenticated' });
  });

  it('refuses a message that names no sender', async () => {
    const anonymous = raw({ To: TO, Subject: 'hi', 'Content-Type': 'text/plain' }, 'hi');
    expect(await inboundReplyOf({ to: TO, raw: anonymous })).toEqual({ refusal: 'mail_unreadable' });
  });
});
