import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from '../../../../src/adapters/github/webhook.js';

const SECRET = 'webhook-secret-for-tests';

async function signatureOf(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return `sha256=${Buffer.from(mac).toString('hex')}`;
}

describe('verifyWebhook', () => {
  it('accepts a body signed with the shared secret, as text or bytes, whatever the hex case', async () => {
    const body = '{"action":"closed"}';
    const signature = await signatureOf(SECRET, new TextEncoder().encode(body));

    expect(await verifyWebhook(SECRET, body, signature)).toEqual({ verified: true });
    expect(await verifyWebhook(SECRET, new TextEncoder().encode(body), signature.toUpperCase().replace('SHA256=', 'sha256='))).toEqual({
      verified: true,
    });
  });

  it('refuses a body signed with another secret, a changed body, and a missing or malformed header', async () => {
    const body = '{"action":"closed"}';
    const signature = await signatureOf(SECRET, new TextEncoder().encode(body));

    expect(await verifyWebhook('another-secret', body, signature)).toEqual({ refusal: 'signature_mismatch' });
    expect(await verifyWebhook(SECRET, '{"action":"reopened"}', signature)).toEqual({ refusal: 'signature_mismatch' });
    expect(await verifyWebhook(SECRET, body, null)).toEqual({ refusal: 'signature_missing' });
    expect(await verifyWebhook(SECRET, body, 'sha1=abc')).toEqual({ refusal: 'signature_malformed' });
  });

  it('refuses every body when no secret is configured', async () => {
    const body = '{}';
    expect(await verifyWebhook('', body, `sha256=${'0'.repeat(64)}`)).toEqual({ refusal: 'secret_missing' });
  });

  it('accepts exactly the signed bytes: any changed byte is refused', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        async (body, at, flip) => {
          const signature = await signatureOf(SECRET, body);
          const changed = Uint8Array.from(body);
          const index = at % changed.length;
          changed[index] = (changed[index] ?? 0) ^ flip;

          expect(await verifyWebhook(SECRET, body, signature)).toEqual({ verified: true });
          expect(await verifyWebhook(SECRET, changed, signature)).toEqual({ refusal: 'signature_mismatch' });
        },
      ),
      { numRuns: 50 },
    );
  });
});
