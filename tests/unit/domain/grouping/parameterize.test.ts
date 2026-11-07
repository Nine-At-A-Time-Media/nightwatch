import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parameterize } from '../../../../src/domain/grouping/parameterize.js';

describe('parameterize', () => {
  it.each([
    ['Order 4521 failed', 'Order <int> failed'],
    ['took 12.75s', 'took <float>s'],
    ['count is 5.', 'count is <int>.'],
    ['user bob@example.com not found', 'user <email> not found'],
    ['GET https://api.example.com/v1/items?id=9 failed', 'GET <url> failed'],
    ['connect 10.0.0.12:5432 refused', 'connect <ipv4>:<int> refused'],
    ['peer fe80::1ff:fe23:4567:890a down', 'peer <ipv6> down'],
    ['row 3f2504e0-4f89-11d3-9a0c-0305e82c3301 missing', 'row <uuid> missing'],
    ['blob d41d8cd98f00b204e9800998ecf8427e corrupt', 'blob <md5> corrupt'],
    ['commit da39a3ee5e6b4b0d3255bfef95601890afd80709 bad', 'commit <sha1> bad'],
    ['pointer 0x7ffd5e8c3a10 invalid', 'pointer <hex> invalid'],
    ['token 9f86d081884c7d659a2f x', 'token <hex> x'],
    ['at 2026-11-07T10:15:30.123Z late', 'at <date> late'],
    ['on 2026-11-07 late', 'on <date> late'],
    ['at 10:15:30 late', 'at <time> late'],
  ])('replaces volatile values in %j', (message, expected) => {
    // Given a message carrying a volatile value, When parameterized, Then a placeholder replaces it.
    expect(parameterize(message)).toBe(expected);
  });

  it('keeps identifiers, versions, quoted strings and C++ scopes as written', () => {
    // Quoted strings are kept on purpose: they usually name a key or a field, which distinguishes crashes.
    expect(parameterize("missing key 'user_id' in user42")).toBe("missing key 'user_id' in user42");
    expect(parameterize('requires version 1.2.3')).toBe('requires version 1.2.3');
    expect(parameterize('std::vector out of range in add::run')).toBe('std::vector out of range in add::run');
  });

  it('is idempotent', () => {
    const alphabet = fc.constantFrom(...'0123456789abcdefxX.:-@/ <>_\'"Zz'.split(''), 'https://', '2026-11-07', 'T10:', '::');
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 30 }), (parts) => {
        const once = parameterize(parts.join(''));
        expect(parameterize(once)).toBe(once);
      }),
    );
  });

  it('groups messages that differ only in a number or a uuid', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.uuid(), fc.uuid(), (a, b, u, v) => {
        expect(parameterize(`job ${a} for ${u} failed`)).toBe(parameterize(`job ${b} for ${v} failed`));
      }),
    );
  });
});
