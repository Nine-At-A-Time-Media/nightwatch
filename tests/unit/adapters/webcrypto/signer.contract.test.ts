// Signer contract: the fake and the Web Crypto HMAC adapter agree that a
// signature verifies for the text it was made for, and for nothing else.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HmacSigner } from '../../../../src/adapters/webcrypto/hmac-signer.js';
import type { Signer } from '../../../../src/ports/signer.js';
import { FakeSigner } from '../../../_fakes/fake-signer.js';

describe.each<{ name: string; make: () => Signer }>([
  { name: 'FakeSigner', make: () => new FakeSigner('secret') },
  { name: 'HmacSigner', make: () => new HmacSigner('a reply-token secret of some length') },
])('Signer contract -- $name', ({ make }) => {
  it('verifies a signature for the text it signed', async () => {
    const signer = make();
    const signature = await signer.sign('project-1|issue-1|member-mia');
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await signer.verify({ text: 'project-1|issue-1|member-mia', signature })).toBe(true);
  });

  it('rejects the signature for any other text, and a tampered signature', async () => {
    const signer = make();
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (text, other) => {
        fc.pre(text !== other);
        const signature = await signer.sign(text);
        expect(await signer.verify({ text: other, signature })).toBe(false);
        expect(await signer.verify({ text, signature: `${signature}x` })).toBe(false);
      }),
      { numRuns: 25 },
    );
  });
});

describe('HmacSigner', () => {
  it('signs differently under different secrets', async () => {
    const one = await new HmacSigner('secret one').sign('text');
    const two = await new HmacSigner('secret two').sign('text');
    expect(one).not.toBe(two);
    expect(await new HmacSigner('secret two').verify({ text: 'text', signature: one })).toBe(false);
  });
});
