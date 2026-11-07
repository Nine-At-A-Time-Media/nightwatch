// inboundReplyOf: the email adapter's MIME parse of a reply delivered to the
// inbound-mail Worker. It yields the Inbound Reply applyEmailReply takes --
// the address the mail was delivered to, its From, and its plain text --
// and refuses a message the receiving server did not authenticate (design
// Security: a claimed sender alone is not authentication), or that names no
// sender. Only the topmost Authentication-Results, the one the receiving
// server added, counts; a sender can write any header below it.
import { describe, expect, it } from 'vitest';
import { inboundReplyOf } from '../../../../src/adapters/email/inbound-reply.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const TO = 'reply+abc.def@reply.example.test';

function raw(headers: Record<string, string>, body: string): Uint8Array {
  const lines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
  return new TextEncoder().encode([...lines, '', body].join('\r\n'));
}

const PASSED =
  'mx.cloudflare.example; spf=pass smtp.mailfrom=example.test; dkim=pass header.d=example.test; dmarc=pass header.from=example.test';

const PLAIN = {
  'Authentication-Results': PASSED,
  From: 'Ada Lovelace <ada@example.test>',
  To: TO,
  Subject: 'Re: Issue resolved',
  'Content-Type': 'text/plain; charset=utf-8',
};

describe('inboundReplyOf', () => {
  it('reads the delivery address, the From address and the plain text of a reply', async () => {
    const reply = await inboundReplyOf({ to: TO, raw: raw(PLAIN, 'Still broken for me.\r\n\r\n> earlier text') });
    expect(reply).toEqual({ to: TO, from: 'ada@example.test', text: 'Still broken for me.\n\n> earlier text\n' });
  });

  it('reads the text part of a multipart reply', async () => {
    const multipart = raw(
      { ...PLAIN, 'Content-Type': 'multipart/alternative; boundary="b1"' },
      [
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Plain words.',
        '--b1',
        'Content-Type: text/html',
        '',
        '<p>Plain words.</p>',
        '--b1--',
      ].join('\r\n'),
    );
    const reply = await inboundReplyOf({ to: TO, raw: multipart });
    expect(isRefusal(reply) ? reply : reply.text.trim()).toBe('Plain words.');
  });

  it('refuses a reply whose authentication results say DMARC failed', async () => {
    const forged = raw({ ...PLAIN, 'Authentication-Results': 'mx.example.test; spf=pass; dmarc=fail header.from=example.test' }, 'hi');
    expect(await inboundReplyOf({ to: TO, raw: forged })).toEqual({ refusal: 'mail_unauthenticated' });
  });

  it('refuses a reply no authentication result vouches for', async () => {
    const unauthenticated = Object.fromEntries(Object.entries(PLAIN).filter(([key]) => key !== 'Authentication-Results'));
    expect(await inboundReplyOf({ to: TO, raw: raw(unauthenticated, 'hi') })).toEqual({ refusal: 'mail_unauthenticated' });
  });

  it("refuses a reply that passes only in a header below the receiving server's", async () => {
    const lines = [
      'Authentication-Results: mx.cloudflare.example; dmarc=fail header.from=example.test',
      `Authentication-Results: ${PASSED}`,
      'From: ada@example.test',
      `To: ${TO}`,
      'Content-Type: text/plain',
      '',
      'hi',
    ];
    expect(await inboundReplyOf({ to: TO, raw: new TextEncoder().encode(lines.join('\r\n')) })).toEqual({
      refusal: 'mail_unauthenticated',
    });
  });

  it('refuses a message that names no sender', async () => {
    const anonymous = raw({ 'Authentication-Results': PASSED, To: TO, Subject: 'hi', 'Content-Type': 'text/plain' }, 'hi');
    expect(await inboundReplyOf({ to: TO, raw: anonymous })).toEqual({ refusal: 'mail_unreadable' });
  });
});
