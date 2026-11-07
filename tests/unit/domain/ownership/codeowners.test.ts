import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ownersByCodeowners, parseCodeowners } from '../../../../src/domain/ownership/codeowners.js';

const FILE = [
  '# default owners',
  '*       @acme/web',
  '',
  '*.sql   dba@acme.example',
  '/src/checkout/   @ada-gh @acme/payments',
  'docs/   @acme/docs',
  'build/logs/',
  'apps/**/test.ts @tess',
].join('\n');

function ownersOf(path: string) {
  return ownersByCodeowners(parseCodeowners(FILE), path);
}

describe('CODEOWNERS', () => {
  it('reads @user, @org/team and email owners', () => {
    expect(parseCodeowners('/src/ @ada-gh @acme/payments ada@acme.example')).toEqual([
      {
        pattern: '/src/',
        owners: [
          { kind: 'login', login: 'ada-gh' },
          { kind: 'tracker_team', slug: 'acme/payments' },
          { kind: 'email', email: 'ada@acme.example' },
        ],
      },
    ]);
  });

  it('the last matching line wins', () => {
    expect(ownersOf('src/checkout/pay.ts')).toEqual([
      { kind: 'login', login: 'ada-gh' },
      { kind: 'tracker_team', slug: 'acme/payments' },
    ]);
    expect(ownersOf('src/cart.ts')).toEqual([{ kind: 'tracker_team', slug: 'acme/web' }]);
    expect(ownersOf('db/migrations/001.sql')).toEqual([{ kind: 'email', email: 'dba@acme.example' }]);
  });

  it('a leading slash anchors at the root; a pattern without one in its middle matches at any depth', () => {
    expect(ownersOf('lib/src/checkout/pay.ts')).toEqual([{ kind: 'tracker_team', slug: 'acme/web' }]);
    expect(ownersOf('packages/site/docs/intro.md')).toEqual([{ kind: 'tracker_team', slug: 'acme/docs' }]);
  });

  it('a double star crosses directories', () => {
    expect(ownersOf('apps/shop/unit/test.ts')).toEqual([{ kind: 'login', login: 'tess' }]);
  });

  it('a matching line with no owners leaves the path unowned', () => {
    expect(ownersOf('build/logs/today.txt')).toEqual([]);
  });

  it('a file with no matching line owns nothing, and malformed owners are skipped', () => {
    expect(ownersByCodeowners(parseCodeowners('/lib/ @x'), 'src/a.ts')).toEqual([]);
    expect(parseCodeowners('/lib/ @ nobody @x')).toEqual([{ pattern: '/lib/', owners: [{ kind: 'login', login: 'x' }] }]);
  });

  it('a lone star owns every path', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z0-9._-]{1,8}$/), { minLength: 1, maxLength: 5 }), (segments) => {
        const owners = ownersByCodeowners(parseCodeowners('* @acme/web'), segments.join('/'));
        return owners.length === 1;
      }),
    );
  });
});
