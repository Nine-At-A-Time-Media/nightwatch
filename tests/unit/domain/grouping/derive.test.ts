import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { deriveFingerprints } from '../../../../src/domain/grouping/derive.js';
import { gv1 } from '../../../../src/domain/grouping/grouping-version.js';
import { parseFingerprintRules, type FingerprintRule } from '../../../../src/domain/grouping/fingerprint-rules.js';
import { parseStackTraceRules, type StackTraceRule } from '../../../../src/domain/grouping/stack-trace-rules.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { GroupingFrame, GroupingInput } from '../../../../src/domain/grouping/grouping-input.js';

// --- builders ---

const appFrame: GroupingFrame = {
  module: 'app.billing',
  absPath: '/srv/app/billing.py',
  function: 'charge',
  inApp: true,
  lineno: 41,
  colno: 3,
};
const vendorFrame: GroupingFrame = {
  module: 'requests.sessions',
  absPath: '/venv/lib/requests/sessions.py',
  function: 'send',
  inApp: false,
  lineno: 600,
};
const otherVendorFrame: GroupingFrame = { module: 'urllib3.pool', function: 'urlopen', inApp: false, lineno: 12 };

function crash(overrides: Partial<GroupingInput> = {}, frames: readonly GroupingFrame[] = [vendorFrame, appFrame]): GroupingInput {
  return {
    exceptions: [{ type: 'PaymentError', value: 'card 4242 declined', frames }],
    stacktrace: null,
    message: null,
    platform: 'python',
    fingerprint: null,
    logger: null,
    level: 'error',
    tags: {},
    ...overrides,
  };
}

function message(formatted: string, template: string | null = null): GroupingInput {
  return crash({ exceptions: [], message: { formatted, template, params: [] } });
}

function stackRules(text: string): readonly StackTraceRule[] {
  const rules = parseStackTraceRules(text);
  if (isRefusal(rules)) throw new Error(rules.refusal);
  return rules;
}

function fingerprintRules(text: string): readonly FingerprintRule[] {
  const rules = parseFingerprintRules(text);
  if (isRefusal(rules)) throw new Error(rules.refusal);
  return rules;
}

function derive(input: GroupingInput, rules: { fingerprintRules?: string; stackTraceRules?: string } = {}) {
  return deriveFingerprints(input, {
    version: gv1,
    fingerprintRules: fingerprintRules(rules.fingerprintRules ?? ''),
    stackTraceRules: stackRules(rules.stackTraceRules ?? ''),
  });
}

function shares(a: readonly string[], b: readonly string[]): boolean {
  return a.some((fingerprint) => b.includes(fingerprint));
}

// --- behaviors ---

describe('deriveFingerprints', () => {
  it('Same crash, same issue: Given two occurrences of one crash, When derived, Then they yield the same Fingerprints', () => {
    const first = derive(crash());
    expect(first.length).toBeGreaterThan(0);
    first.forEach((fingerprint) => expect(fingerprint).toMatch(/^[0-9a-f]{32}$/));
    expect(derive(crash())).toEqual(first);
  });

  it('Same crash, same issue: a different crash site yields different Fingerprints', () => {
    const elsewhere = { ...appFrame, function: 'refund' };
    expect(shares(derive(crash()), derive(crash({}, [vendorFrame, elsewhere])))).toBe(false);
  });

  it('Volatile parts ignored: Given two events differing only in line numbers, columns, addresses, build hashes and query strings, Then the Fingerprints are equal', () => {
    const browser = (path: string, fn: string, lineno: number): GroupingInput =>
      crash({ platform: 'javascript' }, [{ absPath: path, function: fn, lineno, colno: lineno * 3, inApp: true }]);
    expect(derive(browser('https://cdn.example.com/js/main.3f2a9c1b.js?v=1', 'render', 10))).toEqual(
      derive(browser('https://cdn.example.com/js/main.9c0d1e2f.js?v=2', 'render', 4410)),
    );
    expect(derive(crash({}, [{ ...appFrame, function: 'charge+0x1a' }]))).toEqual(derive(crash({}, [{ ...appFrame, lineno: 7 }])));
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (lineno, colno) => {
        expect(derive(crash({}, [vendorFrame, { ...appFrame, lineno, colno }]))).toEqual(derive(crash()));
      }),
    );
  });

  it('SDK fingerprint wins: Given an SDK fingerprint without the default token, Then only that fingerprint is used', () => {
    const custom = derive(crash({ fingerprint: ['payment-provider-down'] }));
    expect(custom).toHaveLength(1);
    expect(derive(crash({ fingerprint: ['payment-provider-down'], exceptions: [] }))).toEqual(custom);
    expect(shares(custom, derive(crash()))).toBe(false);
    expect(derive(crash({ fingerprint: ['payment-provider-down', 'eu'] }))).not.toEqual(custom);
  });

  it('SDK fingerprint wins: it outranks a matching Fingerprint Rule', () => {
    const rules = { fingerprintRules: 'type:PaymentError -> payments' };
    expect(derive(crash({ fingerprint: ['mine'] }), rules)).toEqual(derive(crash({ fingerprint: ['mine'] })));
  });

  it('Default token extends: Given an SDK fingerprint with the default token and a value, Then the event groups apart from the default Fingerprint alone', () => {
    const plain = derive(crash());
    const salted = derive(crash({ fingerprint: ['{{ default }}', 'tenant-a'] }));
    expect(salted).toHaveLength(plain.length);
    expect(shares(salted, plain)).toBe(false);
    expect(shares(salted, derive(crash({ fingerprint: ['{{ default }}', 'tenant-b'] })))).toBe(false);
    expect(derive(crash({ fingerprint: ['{{default}}', 'tenant-a'] }))).toEqual(salted);
    expect(derive(crash({ fingerprint: ['{{  default  }}'] }))).toEqual(plain);
  });

  it('prefers in-app frames: an app Fingerprint ignores out-of-app frames, a system Fingerprint keeps them', () => {
    const viaRequests = derive(crash());
    const viaUrllib = derive(crash({}, [otherVendorFrame, appFrame]));
    expect(viaRequests).toHaveLength(2);
    expect(viaRequests.filter((fingerprint) => viaUrllib.includes(fingerprint))).toHaveLength(1);
  });

  it('yields one Fingerprint when no frame is in-app', () => {
    expect(derive(crash({}, [vendorFrame, otherVendorFrame]))).toHaveLength(1);
  });

  it('uses the exception value only when no frame contributes', () => {
    const noFrames = (value: string) => crash({ exceptions: [{ type: 'KeyError', value, frames: [] }] });
    expect(derive(noFrames('user 12'))).toEqual(derive(noFrames('user 99')));
    expect(derive(noFrames('user'))).not.toEqual(derive(noFrames('account')));
    const withFrames = (value: string) => crash({ exceptions: [{ type: 'KeyError', value, frames: [appFrame] }] });
    expect(derive(withFrames('user'))).toEqual(derive(withFrames('account')));
  });

  it('ignores the type and value of an exception a synthetic mechanism captured', () => {
    const signal = (type: string) =>
      crash({ exceptions: [{ type, value: type, mechanism: { type: 'signal', synthetic: true }, frames: [appFrame] }] });
    expect(derive(signal('SIGSEGV / 0x0'))).toEqual(derive(signal('SIGSEGV / 0x1')));
  });

  it('falls back to the stack trace, then to the parameterized message', () => {
    const thread = (frames: readonly GroupingFrame[]) =>
      crash({ exceptions: [], stacktrace: frames, message: { formatted: 'x', template: null, params: [] } });
    expect(derive(thread([appFrame]))).not.toEqual(derive(thread([{ ...appFrame, function: 'refund' }])));
    expect(derive(message('job 12 failed after 3.5s'))).toEqual(derive(message('job 977 failed after 0.25s')));
    expect(derive(message('job 12 failed'))).not.toEqual(derive(message('queue 12 failed')));
    expect(derive(message('user 5 left', 'user %s left'))).toEqual(derive(message('user 6 left', 'user %s left')));
    expect(derive(crash({ exceptions: [], message: null }))).toHaveLength(1);
  });

  it('collapses directly recursive frames', () => {
    const recursive = { module: 'app.tree', function: 'walk', inApp: true };
    const once = derive(crash({}, [appFrame, recursive]));
    expect(derive(crash({}, [appFrame, recursive, { ...recursive, lineno: 9 }, recursive]))).toEqual(once);
    expect(derive(crash({}, [recursive, appFrame, recursive]))).not.toEqual(once);
  });

  it('applies Stack Trace Rules: +app adds an app Fingerprint, -group removes a frame from grouping', () => {
    const vendorOnly = crash({}, [vendorFrame, otherVendorFrame]);
    expect(derive(vendorOnly, { stackTraceRules: 'module:urllib3.* +app' })).toHaveLength(2);
    const rules = { stackTraceRules: 'module:requests.* -group' };
    expect(derive(crash(), rules)).not.toEqual(derive(crash()));
    expect(derive(crash({}, [vendorFrame, otherVendorFrame, appFrame]), rules)).toEqual(
      derive(crash({}, [otherVendorFrame, appFrame]), rules),
    );
  });

  it('applies Fingerprint Rules: a matching rule replaces derivation, or extends it with the default token', () => {
    const rules = { fingerprintRules: 'type:PaymentError -> payments' };
    const elsewhere = crash({}, [{ ...appFrame, function: 'refund' }]);
    expect(derive(crash(), rules)).toHaveLength(1);
    expect(derive(crash(), rules)).toEqual(derive(elsewhere, rules));
    expect(derive(crash(), rules)).toEqual(derive(crash({ fingerprint: ['payments'] })));
    const extending = { fingerprintRules: 'type:PaymentError -> {{ default }}, payments' };
    expect(derive(crash(), extending)).toEqual(derive(crash({ fingerprint: ['{{ default }}', 'payments'] })));
    expect(derive(crash(), { fingerprintRules: 'type:Other -> payments' })).toEqual(derive(crash()));
  });

  it('changes every Fingerprint when the Grouping Version id changes', () => {
    const empty = { fingerprintRules: [], stackTraceRules: [] };
    const next = { ...gv1, id: 'gv-next' };
    for (const input of [crash(), message('boom'), crash({ fingerprint: ['x'] })]) {
      expect(shares(deriveFingerprints(input, { version: gv1, ...empty }), deriveFingerprints(input, { version: next, ...empty }))).toBe(
        false,
      );
    }
  });

  it('keeps gv1 immutable', () => {
    expect(Object.isFrozen(gv1)).toBe(true);
    expect(gv1.id).toBe('gv1');
  });
});
