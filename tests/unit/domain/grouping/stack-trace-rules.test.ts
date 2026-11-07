import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyStackTraceRules, parseStackTraceRules } from '../../../../src/domain/grouping/stack-trace-rules.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { GroupingFrame } from '../../../../src/domain/grouping/grouping-input.js';

function parsed(text: string) {
  const rules = parseStackTraceRules(text);
  if (isRefusal(rules)) throw new Error(rules.refusal);
  return rules;
}

describe('parseStackTraceRules', () => {
  it('reads matchers and actions, skipping blank lines and comments', () => {
    const rules = parsed('# vendor code\n\npath:**/node_modules/** -app -group\nfunction:"handle request" module:app.* +app\n');
    expect(rules).toEqual([
      {
        matchers: [{ key: 'path', glob: '**/node_modules/**' }],
        actions: ['-app', '-group'],
      },
      {
        matchers: [
          { key: 'function', glob: 'handle request' },
          { key: 'module', glob: 'app.*' },
        ],
        actions: ['+app'],
      },
    ]);
  });

  it.each([
    ['path:foo', 'no action'],
    ['+app', 'no matcher'],
    ['colour:red +app', 'unknown matcher'],
    ['path: +app', 'empty glob'],
    ['path:x +app -app', 'conflicting actions'],
    ['path:x +grop', 'unknown action'],
    ['path:"x +app', 'unterminated quote'],
    ['path:x tags.k:y +app', 'tags are not a frame matcher'],
  ])('refuses %j (%s) and names the line', (line) => {
    const result = parseStackTraceRules(`path:ok +app\n${line}`);
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.refusal).toMatch(/line 2/);
  });

  it('never throws on arbitrary text: it parses or refuses', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = parseStackTraceRules(text);
        expect(isRefusal(result) || Array.isArray(result)).toBe(true);
      }),
    );
  });
});

describe('applyStackTraceRules', () => {
  const vendor: GroupingFrame = { absPath: '/srv/app/node_modules/lib/index.js', function: 'call', inApp: true };
  const mine: GroupingFrame = { module: 'app.billing', function: 'charge' };

  it('sets in-app by +app and -app and excludes frames by -group', () => {
    const rules = parsed('path:**/node_modules/** -app -group\nmodule:app.* +app');
    expect(applyStackTraceRules({ frames: [vendor, mine], platform: 'node', rules })).toEqual([
      { frame: vendor, inApp: false, grouped: false },
      { frame: mine, inApp: true, grouped: true },
    ]);
  });

  it('keeps the SDK in-app flag when no rule matches, and lets the last matching rule decide in-app', () => {
    const rules = parsed('function:charge -app\nmodule:app.billing +app');
    expect(applyStackTraceRules({ frames: [vendor, mine], platform: 'python', rules })).toEqual([
      { frame: vendor, inApp: true, grouped: true },
      { frame: mine, inApp: true, grouped: true },
    ]);
  });

  it('matches family against the platform family', () => {
    const rules = parsed('family:native function:charge -group');
    expect(applyStackTraceRules({ frames: [mine], platform: 'cocoa', rules })[0]?.grouped).toBe(false);
    expect(applyStackTraceRules({ frames: [mine], platform: 'javascript', rules })[0]?.grouped).toBe(true);
  });
});
