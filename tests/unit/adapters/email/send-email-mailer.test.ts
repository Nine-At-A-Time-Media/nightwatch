// SendEmailMailer: the Mailer over the Email Sending binding. It composes
// the message with the binding's structured builder from the sender
// address it was given, and reports a send the binding rejects as not ok,
// retryable.
import { describe, expect, it } from 'vitest';
import { SendEmailMailer, type MailBinding } from '../../../../src/adapters/email/send-email-mailer.js';

type Sent = Parameters<MailBinding['send']>[0];

class FakeBinding implements MailBinding {
  readonly sent: Sent[] = [];
  failure: Error | null = null;

  async send(builder: Sent): Promise<unknown> {
    if (this.failure) throw this.failure;
    this.sent.push(builder);
    return { messageId: `m-${this.sent.length}` };
  }
}

const MESSAGE = { to: 'ada@example.com', subject: 'Report received', text: 'Your reference is abc.', headers: { 'X-Nightwatch': '1' } };

describe('SendEmailMailer', () => {
  it('sends the message from the configured sender and reports ok', async () => {
    const binding = new FakeBinding();
    const mailer = new SendEmailMailer({ binding, from: 'nightwatch@acme.example' });
    expect(await mailer.send(MESSAGE)).toEqual({ ok: true });
    expect(binding.sent).toEqual([
      {
        from: 'nightwatch@acme.example',
        to: 'ada@example.com',
        subject: 'Report received',
        text: 'Your reference is abc.',
        headers: { 'X-Nightwatch': '1' },
      },
    ]);
  });

  it('passes an html body when the message has one', async () => {
    const binding = new FakeBinding();
    await new SendEmailMailer({ binding, from: 'nightwatch@acme.example' }).send({ ...MESSAGE, html: '<p>hi</p>' });
    expect(binding.sent[0]).toMatchObject({ html: '<p>hi</p>' });
  });

  it('reports a send the binding rejects as not ok and retryable', async () => {
    const binding = new FakeBinding();
    binding.failure = new Error('rate limited');
    expect(await new SendEmailMailer({ binding, from: 'nightwatch@acme.example' }).send(MESSAGE)).toEqual({ ok: false, retryable: true });
  });
});
