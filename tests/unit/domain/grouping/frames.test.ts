import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeFilename, normalizeFunction, normalizeModule } from '../../../../src/domain/grouping/frames.js';

describe('normalizeFilename', () => {
  it.each([
    ['/srv/app/billing/charge.py', 'charge.py'],
    ['C:\\app\\src\\Program.cs', 'Program.cs'],
    ['https://cdn.example.com/static/js/main.3f2a9c1b.js?v=17#x', 'main.js'],
    ['https://cdn.example.com/assets/index-BxK3_9aQ.js', 'index.js'],
    ['/static/chunk-abc123def.js', 'chunk.js'],
    ['/lib/jquery-3.6.0.min.js', 'jquery.min.js'],
    ['/lib/app@1.2.3.js', 'app.js'],
    ['/lib/my_module_ab12cd34.js', 'my_module.js'],
    ['/lib/react.production.min.js', 'react.production.min.js'],
    ['/lib/some-file.js', 'some-file.js'],
  ])('reduces %j to %j', (path, expected) => {
    expect(normalizeFilename(path)).toBe(expected);
  });

  it('gives the same name whatever build hash a bundle carries', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{8}$/), fc.stringMatching(/^[0-9a-f]{8}$/), (a, b) => {
        fc.pre(/\d/.test(a) && /\d/.test(b));
        expect(normalizeFilename(`/js/main.${a}.js`)).toBe(normalizeFilename(`/js/main.${b}.js`));
      }),
    );
  });
});

describe('normalizeFunction', () => {
  it.each([
    ['handleRequest', 'handleRequest'],
    ['Object.<anonymous>', 'Object.<anonymous>'],
    ['process [as handle]', 'process'],
    ['worker_loop+0x1a', 'worker_loop'],
    ['crash (0x7ffd5e8c3a10)', 'crash'],
    ['lambda$main$0', 'lambda$main$'],
    ['com.example.App$$Lambda$14/0x0000000800c03000.run', 'com.example.App$$Lambda.run'],
    ['my_crate::run::{closure#0}', 'my_crate::run::{closure}'],
    ['__22-[Foo bar]_block_invoke_2', '__22-[Foo bar]_block_invoke'],
    ['main.main.func1.2', 'main.main.func'],
    ['<Main>b__0_1', '<Main>b__'],
  ])('reduces %j to %j', (name, expected) => {
    expect(normalizeFunction(name)).toBe(expected);
  });

  it.each(['?', '<anonymous>', 'anonymous', '<unknown>', '', '  ', '0x7ffd5e8c3a10'])('treats %j as no function', (name) => {
    expect(normalizeFunction(name)).toBeNull();
  });
});

describe('normalizeModule', () => {
  it('drops lambda counters and addresses', () => {
    expect(normalizeModule('com.example.App$$Lambda$14/0x0000000800c03000')).toBe('com.example.App$$Lambda');
    expect(normalizeModule('app.billing')).toBe('app.billing');
  });
});
