// Mailer contract: every Mailer -- the fake, and the Email Sending adapter
// over a `send_email` binding -- reports ok once a message is accepted, and
// reports a failed send as retryable. The adapter also hands the binding the
// message whole, from its configured sender, in each field's own slot.
import { describe, expect, it } from 'vitest';
import { SendEmailMailer, type SendEmailBinding, type SentEmail } from '../../../../src/adapters/email/send-email-mailer.js';
import type { Mailer, MailMessage } from '../../../../src/ports/mailer.js';
import { FakeMailer } from '../../../_fakes/fake-mailer.js';

const MESSAGE: MailMessage = {
  to: 'ada@example.com',
  subject: 'Your report NW-7 is resolved',
  text: 'The fix shipped in api@1.2.0.',
  html: '<p>The fix shipped in api@1.2.0.</p>',
  headers: { 'List-Unsubscribe': '<https://console.example/u/abc>' },
};

/** A `send_email` binding that keeps what it was handed, or throws when told to. */
class FakeSendEmailBinding implements SendEmailBinding {
  readonly sent: SentEmail[] = [];
  failing = false;

  async send(message: SentEmail): Promise<{ messageId: string }> {
    if (this.failing) throw new Error('send_email: rejected');
    this.sent.push(message);
    return { messageId: `m${this.sent.length}` };
  }
}

type Rig = { mailer: Mailer; fail: () => void };

describe.each<{ name: string; make: () => Rig }>([
  {
    name: 'FakeMailer',
    make: () => {
      const mailer = new FakeMailer();
      return { mailer, fail: () => (mailer.failure = { retryable: true }) };
    },
  },
  {
    name: 'SendEmailMailer',
    make: () => {
      const binding = new FakeSendEmailBinding();
      return { mailer: new SendEmailMailer({ binding, from: 'nightwatch@acme.example' }), fail: () => (binding.failing = true) };
    },
  },
])('Mailer contract -- $name', ({ make }) => {
  it('a message accepted for delivery reports ok', async () => {
    const { mailer } = make();
    expect(await mailer.send(MESSAGE)).toEqual({ ok: true });
  });

  it('a send that fails reports retryable', async () => {
    const { mailer, fail } = make();
    fail();
    expect(await mailer.send(MESSAGE)).toEqual({ ok: false, retryable: true });
  });
});

describe('SendEmailMailer', () => {
  it('hands the binding the message from its configured sender, each field in its own slot', async () => {
    const binding = new FakeSendEmailBinding();
    await new SendEmailMailer({ binding, from: 'nightwatch@acme.example' }).send(MESSAGE);
    expect(binding.sent).toEqual([
      {
        from: 'nightwatch@acme.example',
        to: 'ada@example.com',
        subject: 'Your report NW-7 is resolved',
        text: 'The fix shipped in api@1.2.0.',
        html: '<p>The fix shipped in api@1.2.0.</p>',
        headers: { 'List-Unsubscribe': '<https://console.example/u/abc>' },
      },
    ]);
  });

  it('a text-only message is sent without an html part', async () => {
    const binding = new FakeSendEmailBinding();
    const textOnly: MailMessage = { to: MESSAGE.to, subject: MESSAGE.subject, text: MESSAGE.text, headers: MESSAGE.headers };
    await new SendEmailMailer({ binding, from: 'nightwatch@acme.example' }).send(textOnly);
    expect(binding.sent[0]).not.toHaveProperty('html');
  });
});
