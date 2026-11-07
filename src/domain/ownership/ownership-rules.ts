/**
 * Ownership Rules -- a Project's rules mapping a match to owners (design
 * Issues, Ownership; Domain Language: Ownership Rule). The last matching rule
 * wins; Ownership Rules outrank CODEOWNERS, which the caller decides.
 *
 * The language is one rule per line: a matcher, then one or more owners,
 * separated by whitespace. Blank lines and lines starting with `#` are
 * skipped. A matcher is `path:<glob>` (any stack frame's path, also below a
 * deeper root), `module:<glob>` (any frame's module), `url:<glob>` (the
 * request URL) or `tags.<key>:<glob>` (that tag's value). An owner is a
 * Member's address or a Team as `#name`. A line that cannot be read is
 * reported by its number and skipped, so one bad line never hides the rest.
 */

import type { OwnershipFacts } from './facts.js';
import { matchesPathGlob, matchesTextGlob } from './glob.js';
import { isEmailAddress, type OwnerRef } from './owner.js';

export type OwnershipMatcher =
  | { readonly kind: 'path'; readonly pattern: string }
  | { readonly kind: 'module'; readonly pattern: string }
  | { readonly kind: 'url'; readonly pattern: string }
  | { readonly kind: 'tag'; readonly key: string; readonly pattern: string };

export type OwnershipRule = { readonly matcher: OwnershipMatcher; readonly owners: readonly OwnerRef[] };

export type OwnershipRuleError = { readonly line: number; readonly reason: 'unknown_matcher' | 'no_owners' | 'invalid_owner' };

export type ParsedOwnershipRules = { readonly rules: readonly OwnershipRule[]; readonly errors: readonly OwnershipRuleError[] };

const LINE_BREAK = /\r\n|\r|\n/;
const WHITESPACE = /\s+/;
const MATCHER = /^(path|module|url|tags\.([^:\s]+)):(\S+)$/;
const TEAM = /^#([^\s#]+)$/;

// --- sub-component: parsing ---

function isSkipped(line: string): boolean {
  return line === '' || line.startsWith('#');
}

function matcherOf(text: string): OwnershipMatcher | null {
  const match = MATCHER.exec(text);
  if (!match?.[1] || !match[3]) return null;
  const [, kind, key, pattern] = match;
  if (key !== undefined) return { kind: 'tag', key, pattern };
  if (kind === 'path' || kind === 'module' || kind === 'url') return { kind, pattern };
  return null;
}

function ownerOf(text: string): OwnerRef | null {
  const team = TEAM.exec(text)?.[1];
  if (team !== undefined) return { kind: 'team', team };
  return isEmailAddress(text) ? { kind: 'email', email: text } : null;
}

function ruleOf(line: string, number: number): OwnershipRule | OwnershipRuleError {
  const [matcherText = '', ...ownerTexts] = line.split(WHITESPACE);
  const matcher = matcherOf(matcherText);
  if (matcher === null) return { line: number, reason: 'unknown_matcher' };
  if (ownerTexts.length === 0) return { line: number, reason: 'no_owners' };
  const owners = ownerTexts.map(ownerOf);
  if (owners.some((owner) => owner === null)) return { line: number, reason: 'invalid_owner' };
  return { matcher, owners: owners.filter((owner): owner is OwnerRef => owner !== null) };
}

export function parseOwnershipRules(text: string): ParsedOwnershipRules {
  const rules: OwnershipRule[] = [];
  const errors: OwnershipRuleError[] = [];
  text.split(LINE_BREAK).forEach((raw, index) => {
    const line = raw.trim();
    if (isSkipped(line)) return;
    const parsed = ruleOf(line, index + 1);
    if ('reason' in parsed) errors.push(parsed);
    else rules.push(parsed);
  });
  return { rules, errors };
}

// --- sub-component: matching ---

function isMatch(matcher: OwnershipMatcher, facts: OwnershipFacts): boolean {
  switch (matcher.kind) {
    case 'path':
      return facts.frames.some((frame) => frame.path !== null && matchesPathGlob(matcher.pattern, frame.path));
    case 'module':
      return facts.frames.some((frame) => frame.module !== null && matchesTextGlob(matcher.pattern, frame.module));
    case 'url':
      return facts.url !== null && matchesTextGlob(matcher.pattern, facts.url);
    case 'tag': {
      const value = facts.tags[matcher.key];
      return value !== undefined && matchesTextGlob(matcher.pattern, value);
    }
  }
}

/** The owners of the last rule that matches the Event; empty when none does. */
export function ownersByRules(rules: readonly OwnershipRule[], facts: OwnershipFacts): readonly OwnerRef[] {
  return rules.findLast((rule) => isMatch(rule.matcher, facts))?.owners ?? [];
}
