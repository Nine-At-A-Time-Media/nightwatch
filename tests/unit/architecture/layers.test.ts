// Architect behaviors (coding skill, Section 1.2) as kept tests: Arrow and
// Grep over the source tree, read from disk. The failure message names the
// file and the import that broke the rule.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SRC = join(ROOT, 'src');

type Layer = 'domain' | 'ports' | 'application' | 'adapters' | 'workers';

const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  ports: ['domain', 'ports'],
  application: ['domain', 'ports', 'application'],
  adapters: ['domain', 'ports', 'adapters'],
  workers: ['domain', 'ports', 'application', 'adapters', 'workers'],
};

const CORE: readonly Layer[] = ['domain', 'ports', 'application'];
const MECHANISM = [
  /\bfetch\s*\(/,
  /process\.env/,
  /from ['"]cloudflare:/,
  /from ['"]@cloudflare\//,
  /from ['"]jose['"]/,
  /from ['"]node:/,
  /\bcrypto\.subtle\b/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function layerOf(file: string): Layer | null {
  const top = relative(SRC, file).split('/')[0];
  return top === 'domain' || top === 'ports' || top === 'application' || top === 'adapters' || top === 'workers' ? top : null;
}

function relativeImports(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

function importedLayer(file: string, specifier: string): Layer | null {
  return layerOf(join(file, '..', specifier));
}

const files = sourceFiles(SRC);

describe('Arrow: every import stays in its layer or goes to a layer below it', () => {
  it.each(files.map((f) => [relative(ROOT, f), f]))('%s', (_name, file) => {
    const layer = layerOf(file);
    if (!layer) return;
    const text = readFileSync(file, 'utf8');
    const violations = relativeImports(text).filter((spec) => {
      const target = importedLayer(file, spec);
      return target !== null && !ALLOWED[layer].includes(target);
    });
    expect(violations, `${layer} imports from a layer above or beside it`).toEqual([]);
  });
});

describe('Grep: the core names no mechanism', () => {
  it.each(files.filter((f) => CORE.includes(layerOf(f) as Layer)).map((f) => [relative(ROOT, f), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(MECHANISM.filter((pattern) => pattern.test(text)).map(String), 'core code names a vendor or I/O mechanism').toEqual([]);
  });
});
