import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { repositoryPathOf, type CodeMapping } from '../../../../src/domain/ownership/code-mapping.js';
import { commitOfLine, isWithinWindow, topInAppFrame, type BlamedCommit } from '../../../../src/domain/ownership/suspect-commit.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);

const WEB: CodeMapping = { repository: 'acme/web', stackRoot: 'app:///', sourceRoot: 'frontend/', ref: 'main' };
const API: CodeMapping = { repository: 'acme/api', stackRoot: '/srv/api/', sourceRoot: '', ref: 'main' };

function commit(hash: string, at: number): BlamedCommit {
  return { hash, author: { email: `${hash}@acme.example`, login: null }, at };
}

describe('Code Mapping', () => {
  it('translates a stack path under its stack root to a repository path under its source root', () => {
    expect(repositoryPathOf([WEB, API], 'app:///src/pay.ts')).toEqual({ mapping: WEB, path: 'frontend/src/pay.ts' });
    expect(repositoryPathOf([WEB, API], '/srv/api/handlers/cart.py')).toEqual({ mapping: API, path: 'handlers/cart.py' });
  });

  it('the longest matching stack root wins', () => {
    const nested: CodeMapping = { repository: 'acme/shared', stackRoot: 'app:///shared/', sourceRoot: 'lib/', ref: 'trunk' };
    expect(repositoryPathOf([WEB, nested], 'app:///shared/date.ts')).toEqual({ mapping: nested, path: 'lib/date.ts' });
  });

  it('a path under no stack root has no repository path', () => {
    expect(repositoryPathOf([WEB, API], 'webpack:///src/pay.ts')).toBeNull();
    expect(repositoryPathOf([], 'app:///src/pay.ts')).toBeNull();
  });

  it('never yields a path with a leading slash or a ./ segment', () => {
    const mapping: CodeMapping = { repository: 'acme/web', stackRoot: '', sourceRoot: './', ref: 'main' };
    fc.assert(
      fc.property(fc.stringMatching(/^[./a-z]{0,20}$/), (path) => {
        const found = repositoryPathOf([mapping], path);
        return found !== null && !found.path.startsWith('/') && !found.path.startsWith('./');
      }),
    );
  });
});

describe('Suspect Commit', () => {
  it('the top in-app frame is the innermost in-app frame with a path and a line', () => {
    const frames = [
      { path: 'src/main.ts', module: null, lineno: 3, inApp: true },
      { path: 'src/pay.ts', module: null, lineno: 42, inApp: true },
      { path: 'node_modules/x.js', module: null, lineno: 9, inApp: false },
    ];
    expect(topInAppFrame({ frames, url: null, tags: {} })).toEqual(frames[1]);
    expect(topInAppFrame({ frames: [{ path: 'src/a.ts', module: null, lineno: null, inApp: true }], url: null, tags: {} })).toBeNull();
    expect(topInAppFrame({ frames: [], url: null, tags: {} })).toBeNull();
  });

  it('the commit that last changed a line is the one whose blame range holds it', () => {
    const ranges = [
      { startingLine: 1, endingLine: 10, commit: commit('aaa', T0) },
      { startingLine: 11, endingLine: 50, commit: commit('bbb', T0) },
    ];
    expect(commitOfLine(ranges, 11)?.hash).toBe('bbb');
    expect(commitOfLine(ranges, 10)?.hash).toBe('aaa');
    expect(commitOfLine(ranges, 51)).toBeNull();
  });

  it('only a commit inside the Suspect Commit Window before the Issue was first seen is named', () => {
    const window = { firstSeen: T0, window: 7 * DAY };
    expect(isWithinWindow(commit('a', T0 - DAY), window)).toBe(true);
    expect(isWithinWindow(commit('b', T0), window)).toBe(true);
    expect(isWithinWindow(commit('c', T0 - 8 * DAY), window)).toBe(false);
    expect(isWithinWindow(commit('d', T0 + 1), window)).toBe(false);
  });

  it('no commit outside the window is ever named', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 * DAY }), fc.integer({ min: -30 * DAY, max: 30 * DAY }), (window, offset) => {
        const named = isWithinWindow(commit('x', T0 + offset), { firstSeen: T0, window });
        return !named || (offset <= 0 && -offset <= window);
      }),
    );
  });
});
