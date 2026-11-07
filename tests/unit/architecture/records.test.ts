// Trace, at the records level: every row of the design's Behaviors tables
// resolves to exactly one use case in the architecture record's use-case
// surface, and every use case named there is backed by a design row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const design = readFileSync(join(ROOT, 'docs/design/DESIGN.NIGHTWATCH.md'), 'utf8');
const architecture = readFileSync(join(ROOT, 'docs/design/ARCHITECTURE.NIGHTWATCH.md'), 'utf8');

function section(text: string, from: string, to: string): string {
  return text.split(from)[1]?.split(to)[0] ?? '';
}

function firstCells(table: string, header: string): string[] {
  return table
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith(`| ${header}`))
    .map((line) => line.split('|')[1]?.trim() ?? '');
}

const behaviors = firstCells(section(design, '## Behaviors', '## State Machine'), 'Behavior');
const traced = firstCells(section(architecture, '## Use-case surface', '## Mechanism'), 'Design behavior').flatMap((cell) =>
  cell.split(';').map((name) => name.trim()),
);

describe('Trace: design behaviors and the use-case surface agree', () => {
  it('maps every design behavior to exactly one use case', () => {
    const missing = behaviors.filter((name) => !traced.includes(name));
    const duplicated = traced.filter((name, i) => traced.indexOf(name) !== i);
    expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
  });

  it('names no behavior the design does not have', () => {
    expect(traced.filter((name) => !behaviors.includes(name))).toEqual([]);
  });
});
