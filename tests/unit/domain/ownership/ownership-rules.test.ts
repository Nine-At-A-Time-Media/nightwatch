import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ownershipFactsOf, type OwnershipFacts } from '../../../../src/domain/ownership/facts.js';
import { ownersByRules, parseOwnershipRules } from '../../../../src/domain/ownership/ownership-rules.js';
import type { NormalizedEvent } from '../../../../src/domain/normalize/normalized-event.js';

function facts(overrides: Partial<OwnershipFacts> = {}): OwnershipFacts {
  return {
    frames: [
      { path: 'node_modules/react/index.js', module: 'react', lineno: 10, inApp: false },
      { path: 'src/checkout/pay.ts', module: 'checkout.pay', lineno: 42, inApp: true },
    ],
    url: 'https://shop.example/checkout/pay',
    tags: { team: 'payments', browser: 'Firefox' },
    ...overrides,
  };
}

describe('parseOwnershipRules', () => {
  it('reads one rule per line, skipping blank lines and comments, with email and #team owners', () => {
    const parsed = parseOwnershipRules(
      ['# owners', '', 'path:src/checkout/* ada@acme.example #payments', 'module:checkout.* #web'].join('\n'),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toEqual([
      {
        matcher: { kind: 'path', pattern: 'src/checkout/*' },
        owners: [
          { kind: 'email', email: 'ada@acme.example' },
          { kind: 'team', team: 'payments' },
        ],
      },
      { matcher: { kind: 'module', pattern: 'checkout.*' }, owners: [{ kind: 'team', team: 'web' }] },
    ]);
  });

  it('reads url and tag matchers', () => {
    const parsed = parseOwnershipRules('url:*/checkout/* #web\ntags.browser:Fire* mia@acme.example');

    expect(parsed.rules.map((rule) => rule.matcher)).toEqual([
      { kind: 'url', pattern: '*/checkout/*' },
      { kind: 'tag', key: 'browser', pattern: 'Fire*' },
    ]);
  });

  it('names the line of each rule it cannot read, and keeps the others', () => {
    const parsed = parseOwnershipRules(
      ['path:src/* #web', 'colour:red #web', 'path:src/*', 'path:src/* not-an-owner', 'tags.:x #web'].join('\n'),
    );

    expect(parsed.rules).toHaveLength(1);
    expect(parsed.errors).toEqual([
      { line: 2, reason: 'unknown_matcher' },
      { line: 3, reason: 'no_owners' },
      { line: 4, reason: 'invalid_owner' },
      { line: 5, reason: 'unknown_matcher' },
    ]);
  });

  it('never throws, and every rule it returns has owners', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const parsed = parseOwnershipRules(text);
        return parsed.rules.every((rule) => rule.owners.length > 0);
      }),
    );
  });
});

describe('ownersByRules', () => {
  it('a path rule matches a frame path, also at a deeper root', () => {
    const { rules } = parseOwnershipRules('path:src/checkout/* #payments');
    expect(ownersByRules(rules, facts())).toEqual([{ kind: 'team', team: 'payments' }]);
    expect(ownersByRules(rules, facts({ frames: [{ path: '/app/src/checkout/pay.ts', module: null, lineno: 1, inApp: true }] }))).toEqual([
      { kind: 'team', team: 'payments' },
    ]);
  });

  it('a single star stays within one path segment; a double star crosses them', () => {
    const deep = facts({ frames: [{ path: 'src/checkout/forms/card.ts', module: null, lineno: 1, inApp: true }] });
    expect(ownersByRules(parseOwnershipRules('path:src/checkout/* #a').rules, deep)).toEqual([]);
    expect(ownersByRules(parseOwnershipRules('path:src/checkout/** #a').rules, deep)).toEqual([{ kind: 'team', team: 'a' }]);
  });

  it('module, url and tag rules match their facts', () => {
    expect(ownersByRules(parseOwnershipRules('module:checkout.* #a').rules, facts())).toEqual([{ kind: 'team', team: 'a' }]);
    expect(ownersByRules(parseOwnershipRules('url:*/checkout/* #b').rules, facts())).toEqual([{ kind: 'team', team: 'b' }]);
    expect(ownersByRules(parseOwnershipRules('tags.team:payments #c').rules, facts())).toEqual([{ kind: 'team', team: 'c' }]);
    expect(ownersByRules(parseOwnershipRules('tags.region:eu #d').rules, facts())).toEqual([]);
    expect(ownersByRules(parseOwnershipRules('url:*/cart #e').rules, facts({ url: null }))).toEqual([]);
  });

  it('the last matching rule wins', () => {
    const { rules } = parseOwnershipRules(['path:src/** #web', 'path:src/checkout/* #payments', 'path:src/admin/* #admin'].join('\n'));
    expect(ownersByRules(rules, facts())).toEqual([{ kind: 'team', team: 'payments' }]);
  });

  it('a rule that matches nothing suggests no one', () => {
    const { rules } = parseOwnershipRules('path:lib/** #web');
    expect(ownersByRules(rules, facts())).toEqual([]);
  });
});

describe('ownershipFactsOf', () => {
  it('takes the frames of the exception raised last, its request URL and tags', () => {
    const event = {
      exceptions: [
        { type: 'Cause', value: null, frames: [{ filename: 'src/cause.ts', lineno: 1 }] },
        {
          type: 'TypeError',
          value: 'x',
          frames: [{ filename: 'src/pay.ts', absPath: '/app/src/pay.ts', module: 'pay', lineno: 7, inApp: true }],
        },
      ],
      stacktrace: null,
      request: { url: 'https://shop.example/pay', headers: {} },
      tags: { team: 'payments' },
    } as unknown as NormalizedEvent;

    expect(ownershipFactsOf(event)).toEqual({
      frames: [{ path: 'src/pay.ts', module: 'pay', lineno: 7, inApp: true }],
      url: 'https://shop.example/pay',
      tags: { team: 'payments' },
    });
  });

  it('falls back to the stack trace sent without an exception, and to the absolute path', () => {
    const event = {
      exceptions: [],
      stacktrace: [{ absPath: '/app/src/pay.ts' }],
      request: null,
      tags: {},
    } as unknown as NormalizedEvent;

    expect(ownershipFactsOf(event)).toEqual({
      frames: [{ path: '/app/src/pay.ts', module: null, lineno: null, inApp: false }],
      url: null,
      tags: {},
    });
  });
});
