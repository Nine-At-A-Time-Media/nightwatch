import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { matchingFingerprintRule, parseFingerprintRules } from '../../../../src/domain/grouping/fingerprint-rules.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { GroupingInput } from '../../../../src/domain/grouping/grouping-input.js';

function parsed(text: string) {
  const rules = parseFingerprintRules(text);
  if (isRefusal(rules)) throw new Error(rules.refusal);
  return rules;
}

const timeout: GroupingInput = {
  exceptions: [
    {
      type: 'TimeoutError',
      value: 'read timed out after 30s',
      frames: [{ module: 'app.db.pool', absPath: '/srv/app/db/pool.py', function: 'acquire' }],
    },
  ],
  stacktrace: null,
  message: null,
  platform: 'python',
  fingerprint: null,
  logger: 'app.db',
  level: 'error',
  tags: { region: 'eu-west' },
};

describe('parseFingerprintRules', () => {
  it('reads matchers and the value list, skipping blank lines and comments', () => {
    expect(parsed('# db\ntype:TimeoutError module:app.db.* -> database-timeout, {{ default }}\n\nmessage:"disk full" -> disk')).toEqual([
      {
        matchers: [
          { key: 'type', glob: 'TimeoutError' },
          { key: 'module', glob: 'app.db.*' },
        ],
        values: ['database-timeout', '{{ default }}'],
      },
      { matchers: [{ key: 'message', glob: 'disk full' }], values: ['disk'] },
    ]);
  });

  it.each([
    ['type:Foo', 'no arrow'],
    ['-> a', 'no matcher'],
    ['type:Foo ->', 'no value'],
    ['type:Foo -> a,,b', 'empty value'],
    ['colour:red -> a', 'unknown matcher'],
    ['tags.:x -> a', 'tag without a key'],
    ['message:"oops -> a', 'unterminated quote'],
  ])('refuses %j (%s) and names the line', (line) => {
    const result = parseFingerprintRules(`type:Ok -> ok\n${line}`);
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.refusal).toMatch(/line 2/);
  });

  it('never throws on arbitrary text: it parses or refuses', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = parseFingerprintRules(text);
        expect(isRefusal(result) || Array.isArray(result)).toBe(true);
      }),
    );
  });
});

describe('matchingFingerprintRule', () => {
  it.each([
    ['type:Timeout*', true],
    ['value:"*timed out*"', true],
    ['message:"*timed out*"', true],
    ['module:app.db.*', true],
    ['function:acquire', true],
    ['path:**/db/*.py', true],
    ['level:error', true],
    ['logger:app.*', true],
    ['tags.region:eu-*', true],
    ['tags.region:us-*', false],
    ['tags.missing:*', false],
    ['type:Timeout* level:warning', false],
    ['type:timeouterror', true],
  ])('%j matches: %s', (matchers, expected) => {
    const rules = parsed(`${matchers} -> grouped`);
    expect(matchingFingerprintRule({ input: timeout, rules }) !== null).toBe(expected);
  });

  it('chooses the first matching rule', () => {
    const rules = parsed('type:Nope -> a\ntype:TimeoutError -> b\nlevel:error -> c');
    expect(matchingFingerprintRule({ input: timeout, rules })?.values).toEqual(['b']);
  });
});
