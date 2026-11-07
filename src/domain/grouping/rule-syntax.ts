/**
 * Rule syntax shared by the Fingerprint Rule and Stack Trace Rule languages:
 * one rule per line, `#` starts a comment line, matchers are `key:glob`, and
 * a double-quoted part may hold spaces (`message:"disk full"`, `\"` for a
 * quote). Globs match the whole value, ignore case, and know two wildcards:
 * `*` (any run of characters, `/` included, so `**` means the same) and `?`
 * (one character).
 */

import { refusal, type Refusal } from '../refusal.js';

export type RuleMatcher = { readonly key: string; readonly glob: string };

export type RuleLine = { readonly number: number; readonly text: string };

const TAG_PREFIX = 'tags.';

// --- predicates ---

function isRuleText(text: string): boolean {
  return text !== '' && !text.startsWith('#');
}

function isKnownKey({ key, keys, tagsAllowed }: { key: string; keys: readonly string[]; tagsAllowed: boolean }): boolean {
  if (keys.includes(key)) return true;
  return tagsAllowed && key.startsWith(TAG_PREFIX) && key.length > TAG_PREFIX.length;
}

// --- helpers ---

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .split('')
    .map((char) => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[\\^$.|+()[\]{}]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`, 'is');
}

// --- exports ---

export function ruleLines(text: string): readonly RuleLine[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ number: index + 1, text: line.trim() }))
    .filter((line) => isRuleText(line.text));
}

export function globMatches({ glob, value }: { glob: string; value: string }): boolean {
  return globToRegExp(glob).test(value);
}

/** Splits on whitespace outside double quotes and removes the quotes. */
export function tokenizeRule(text: string): readonly string[] | Refusal {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quoted && char === '\\' && text.charAt(i + 1) === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quoted) return refusal('unterminated quote');
  if (started) tokens.push(current);
  return tokens;
}

export function parseMatcher({
  token,
  keys,
  tagsAllowed,
}: {
  token: string;
  keys: readonly string[];
  tagsAllowed: boolean;
}): RuleMatcher | Refusal {
  const colon = token.indexOf(':');
  if (colon < 0) return refusal(`expected key:glob, got "${token}"`);
  const key = token.slice(0, colon);
  const glob = token.slice(colon + 1);
  if (!isKnownKey({ key, keys, tagsAllowed })) return refusal(`unknown matcher "${key}"`);
  if (glob === '') return refusal(`empty glob for "${key}"`);
  return { key, glob };
}
