import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { signatureHeaderValid } from '../../../../src/domain/tracker/webhook-signature.js';

const HEX = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
const digest = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => Buffer.from(bytes).toString('hex'));

describe('Webhook signature header', () => {
  it('a sha256 header parses to its algorithm and lowercase hex digest', () => {
    expect(signatureHeaderValid(`sha256=${HEX}`)).toEqual({ algorithm: 'sha256', hex: HEX });
    expect(signatureHeaderValid(` sha256=${HEX.toUpperCase()} `)).toEqual({ algorithm: 'sha256', hex: HEX });
  });

  it('a missing header is refused as missing', () => {
    expect(signatureHeaderValid(null)).toEqual({ refusal: 'signature_missing' });
    expect(signatureHeaderValid('  ')).toEqual({ refusal: 'signature_missing' });
  });

  it('another algorithm, a short or long digest, or a non-hex digest is refused as malformed', () => {
    const headers = [
      `sha1=${HEX.slice(0, 40)}`,
      `sha256=${HEX.slice(1)}`,
      `sha256=${HEX}0`,
      `sha256=${'g'.repeat(64)}`,
      HEX,
      `sha256:${HEX}`,
    ];
    for (const header of headers) expect(signatureHeaderValid(header)).toEqual({ refusal: 'signature_malformed' });
  });

  it('every 32-byte digest round-trips through its header', () => {
    fc.assert(
      fc.property(digest, (hex) => {
        expect(signatureHeaderValid(`sha256=${hex}`)).toEqual({ algorithm: 'sha256', hex });
      }),
    );
  });

  it('anything not shaped sha256=<64 hex> is refused', () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        fc.pre(!/^\s*sha256=[0-9a-fA-F]{64}\s*$/.test(header));
        expect(signatureHeaderValid(header)).toHaveProperty('refusal');
      }),
    );
  });
});
