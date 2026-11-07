import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeReference, isWellFormedReference, REFERENCE_BYTES } from '../../../../src/domain/report/reference.js';

const bytes16 = fc.uint8Array({ minLength: REFERENCE_BYTES, maxLength: REFERENCE_BYTES });

function decode(reference: string): Uint8Array {
  return Uint8Array.from(Buffer.from(reference, 'base64url'));
}

describe('Report Reference', () => {
  it('encodes 128 bits as 22 URL-safe base64 characters with no padding', () => {
    expect(encodeReference(new Uint8Array(16))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(encodeReference(new Uint8Array(16).fill(255))).toBe('_____________________w');
  });

  it('refuses to encode anything but exactly 128 bits', () => {
    expect(encodeReference(new Uint8Array(15))).toBeNull();
    expect(encodeReference(new Uint8Array(17))).toBeNull();
  });

  it('every encoding is URL-safe, well-formed, and decodes back to its bytes', () => {
    fc.assert(
      fc.property(bytes16, (bytes) => {
        const reference = encodeReference(bytes);
        expect(reference).not.toBeNull();
        if (reference === null) return;
        expect(reference).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(encodeURIComponent(reference)).toBe(reference);
        expect(isWellFormedReference(reference)).toBe(true);
        expect(decode(reference)).toEqual(bytes);
      }),
    );
  });

  it('distinct bytes give distinct references', () => {
    fc.assert(
      fc.property(bytes16, bytes16, (a, b) => {
        fc.pre(Buffer.compare(a, b) !== 0);
        expect(encodeReference(a)).not.toBe(encodeReference(b));
      }),
    );
  });

  it('a reference of the wrong length, alphabet or trailing bits is not well-formed', () => {
    expect(isWellFormedReference('')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAA+A')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAA/A')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAAAA==')).toBe(false);
    expect(isWellFormedReference('AAAAAAAAAAAAAAAAAAAAAB')).toBe(false);
  });

  it('only the canonical encoding of 128 bits is well-formed', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), minLength: 22, maxLength: 22 }), (text) => {
        expect(isWellFormedReference(text)).toBe(encodeReference(decode(text)) === text);
      }),
    );
  });
});
