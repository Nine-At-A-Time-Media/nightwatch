import { describe, expect, it } from 'vitest';
import { fingerprintOf, fnv1a128 } from '../../../../src/domain/grouping/fingerprint.js';

describe('fnv1a128', () => {
  it('matches the published FNV-1a 128-bit vectors', () => {
    expect(fnv1a128('')).toBe('6c62272e07bb014262b821756295c58d');
    expect(fnv1a128('a')).toBe('d228cb696f1a8caf78912b704e4a8964');
  });
});

describe('fingerprintOf', () => {
  it('is 32 lowercase hex characters and depends on structure, not only on the joined text', () => {
    expect(fingerprintOf(['gv1', ['a', 'b']])).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(['gv1', ['a', 'b']])).toBe(fingerprintOf(['gv1', ['a', 'b']]));
    expect(fingerprintOf(['gv1', ['a', 'b']])).not.toBe(fingerprintOf(['gv1', ['ab']]));
    expect(fingerprintOf(['gv1', ['a'], ['b']])).not.toBe(fingerprintOf(['gv1', ['a', 'b']]));
  });
});
