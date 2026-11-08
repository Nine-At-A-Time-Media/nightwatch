// WebhookChannel: one POST of the message as JSON, carrying the delivery's
// identity so a receiver can tell a repeat from a new delivery (design
// Alerts and notifications, Outbound actions).
import { describe, expect, it } from 'vitest';
import { WebhookChannel } from '../../../../src/adapters/webhook/webhook-channel.js';
import type { AlertMessage } from '../../../../src/ports/channel.js';

const MESSAGE: AlertMessage = {
  deliveryId: 'rule-1:issue-1:1000',
  projectId: 'project-1',
  ruleId: 'rule-1',
  issueId: 'issue-1',
  subject: 'Alert: TypeError',
  text: 'Rule rule-1 fired.',
};

const HOOK = { kind: 'webhook', url: 'https://hooks.example/a' } as const;

function recorder(status = 200) {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(new Request(input, init));
    return new Response(null, { status });
  };
  return { requests, fetcher };
}

describe('WebhookChannel', () => {
  it('posts the message as JSON with the delivery identity, the same on a repeat', async () => {
    const { requests, fetcher } = recorder();
    const channel = new WebhookChannel(fetcher);
    await channel.deliver(HOOK, MESSAGE);
    await channel.deliver(HOOK, MESSAGE);

    expect(requests).toHaveLength(2);
    const [first, second] = requests;
    expect(first?.method).toBe('POST');
    expect(first?.url).toBe(HOOK.url);
    expect(first?.headers.get('content-type')).toBe('application/json');
    expect(first?.headers.get('x-nightwatch-delivery')).toBe(MESSAGE.deliveryId);
    expect(second?.headers.get('x-nightwatch-delivery')).toBe(MESSAGE.deliveryId);
    expect(await first?.json()).toEqual(MESSAGE);
  });

  it('treats a rate limit and a network failure as retryable', async () => {
    expect(await new WebhookChannel(recorder(429).fetcher).deliver(HOOK, MESSAGE)).toEqual({ ok: false, retryable: true });
    const failing = async (): Promise<Response> => {
      throw new TypeError('network down');
    };
    expect(await new WebhookChannel(failing).deliver(HOOK, MESSAGE)).toEqual({ ok: false, retryable: true });
  });
});
