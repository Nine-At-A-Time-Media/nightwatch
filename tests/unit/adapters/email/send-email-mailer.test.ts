// SendEmailMailer: the Mailer over the Email Sending binding. It sends from
// the notifier's address, keeps threading headers, moves Reply-To into the
// binding's own field, and turns a throw into a retryable failure.
import { describe, expect, it } from 'vitest';
import { SendEmailMailer } from '../../../../src/adapters/email/send-email-mailer.js';

type Sent = EmailMessageBuilder;

/** A send_email binding that keeps every builder it is handed, or throws when told to. */
function recordingBinding(): { binding: SendEmail; sent: Sent[]; failing: { on: boolean } } {
  const sent: Sent[] = [];
  const failing = { on: false };
  const binding = {
    send: async (message: EmailMessage | EmailMessageBuilder) => {
      if (failing.on) throw new Error('sending refused');
      sent.push(message as Sent);
      return { messageId: `<m${sent.length}@example.test>` };
    },
  } as SendEmail;
  return { binding, sent, failing };
}

describe('SendEmailMailer', () => {
  it('sends the message from the notifier address with its threading headers and Reply-To', async () => {
    const { binding, sent } = recordingBinding();
    const mailer = new SendEmailMailer({ binding, from: 'nightwatch@mail.example.test' });

    const result = await mailer.send({
      to: 'ada@example.test',
      subject: 'Issue resolved',
      text: 'It is fixed.',
      headers: {
        'In-Reply-To': '<issue.p.i@mail.example.test>',
        References: '<issue.p.i@mail.example.test>',
        'Reply-To': 'reply+t.s@r.test',
      },
    });

    expect(result).toEqual({ ok: true });
    expect(sent).toEqual([
      {
        from: 'nightwatch@mail.example.test',
        to: 'ada@example.test',
        subject: 'Issue resolved',
        text: 'It is fixed.',
        replyTo: 'reply+t.s@r.test',
        headers: { 'In-Reply-To': '<issue.p.i@mail.example.test>', References: '<issue.p.i@mail.example.test>' },
      },
    ]);
  });

  it('passes html through and omits Reply-To when the message has none', async () => {
    const { binding, sent } = recordingBinding();
    await new SendEmailMailer({ binding, from: 'n@x.test' }).send({
      to: 'a@x.test',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
      headers: {},
    });
    expect(sent).toEqual([{ from: 'n@x.test', to: 'a@x.test', subject: 's', text: 't', html: '<p>t</p>', headers: {} }]);
  });

  it('answers a retryable failure when the binding refuses the send', async () => {
    const { binding, failing } = recordingBinding();
    failing.on = true;
    const result = await new SendEmailMailer({ binding, from: 'n@x.test' }).send({ to: 'a@x.test', subject: 's', text: 't', headers: {} });
    expect(result).toEqual({ ok: false, retryable: true });
  });
});
