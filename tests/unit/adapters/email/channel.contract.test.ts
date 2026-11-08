// Channel contract: every Channel -- the fake, the email channel over the
// Mailer, the webhook channel over fetch -- delivers a message to a
// destination of its own kind and reports ok, and reports a failed delivery
// with whether retrying may succeed. A destination of another kind is never
// delivered.
import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../../../../src/adapters/email/email-channel.js';
import { WebhookChannel } from '../../../../src/adapters/webhook/webhook-channel.js';
import type { AlertMessage, Channel, Destination } from '../../../../src/ports/channel.js';
import { FakeChannel } from '../../../_fakes/fake-channel.js';
import { FakeMailer } from '../../../_fakes/fake-mailer.js';

const MESSAGE: AlertMessage = {
  deliveryId: 'rule-1:issue-1:1000',
  projectId: 'project-1',
  ruleId: 'rule-1',
  issueId: 'issue-1',
  subject: 'Alert: TypeError: x is undefined',
  text: 'Rule rule-1 fired for issue issue-1.',
};

type Rig = { channel: Channel; destination: Destination; other: Destination; fail: (retryable: boolean) => void };

function fakeRig(): Rig {
  const channel = new FakeChannel('webhook');
  return {
    channel,
    destination: { kind: 'webhook', url: 'https://hooks.example/a' },
    other: { kind: 'email', address: 'mia@acme.example' },
    fail: (retryable) => (channel.failure = { retryable }),
  };
}

function emailRig(): Rig {
  const mailer = new FakeMailer();
  return {
    channel: new EmailChannel(mailer),
    destination: { kind: 'email', address: 'mia@acme.example' },
    other: { kind: 'webhook', url: 'https://hooks.example/a' },
    fail: (retryable) => (mailer.failure = { retryable }),
  };
}

function webhookRig(): Rig {
  let status = 204;
  const fetcher = async (): Promise<Response> => new Response(null, { status });
  return {
    channel: new WebhookChannel(fetcher),
    destination: { kind: 'webhook', url: 'https://hooks.example/a' },
    other: { kind: 'email', address: 'mia@acme.example' },
    fail: (retryable) => (status = retryable ? 503 : 410),
  };
}

describe.each<{ name: string; make: () => Rig }>([
  { name: 'FakeChannel', make: fakeRig },
  { name: 'EmailChannel', make: emailRig },
  { name: 'WebhookChannel', make: webhookRig },
])('Channel contract -- $name', ({ make }) => {
  it('delivers to a destination of its kind', async () => {
    const rig = make();
    expect(rig.channel.kind).toBe(rig.destination.kind);
    expect(await rig.channel.deliver(rig.destination, MESSAGE)).toEqual({ ok: true });
  });

  it('reports a failure it may retry', async () => {
    const rig = make();
    rig.fail(true);
    expect(await rig.channel.deliver(rig.destination, MESSAGE)).toEqual({ ok: false, retryable: true });
  });

  it('reports a failure it may not retry', async () => {
    const rig = make();
    rig.fail(false);
    expect(await rig.channel.deliver(rig.destination, MESSAGE)).toEqual({ ok: false, retryable: false });
  });

  it('refuses a destination of another kind, without retry', async () => {
    const rig = make();
    expect(await rig.channel.deliver(rig.other, MESSAGE)).toEqual({ ok: false, retryable: false });
  });
});

describe('EmailChannel', () => {
  it('mails the subject and text to the address', async () => {
    const mailer = new FakeMailer();
    await new EmailChannel(mailer).deliver({ kind: 'email', address: 'mia@acme.example' }, MESSAGE);
    expect(mailer.sent).toEqual([{ to: 'mia@acme.example', subject: MESSAGE.subject, text: MESSAGE.text, headers: {} }]);
  });
});
