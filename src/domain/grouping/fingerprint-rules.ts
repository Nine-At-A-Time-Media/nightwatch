/**
 * Fingerprint Rules -- a Project's rules that give matching Events a chosen
 * fingerprint value list. One rule per line:
 *
 *   matcher:glob [matcher:glob ...] -> value[, value ...]
 *
 * Event matchers: type and value (any exception in the chain), message (the
 * message, else any exception value), level, logger, tags.<key>. Frame
 * matchers: module, function, path (absolute path, else file name); all the
 * frame matchers of one rule must match the same frame, of any exception or
 * the stack trace. A rule matches when every matcher does. The FIRST
 * matching rule wins, so a project lists its most specific rules first.
 * Values are separated by commas and cannot contain one; a value list
 * holding the default token extends the derived Fingerprint (see derive).
 */

import { isRefusal, refusal, type Refusal } from '../refusal.js';
import type { GroupingFrame, GroupingInput } from './grouping-input.js';
import { globMatches, parseMatcher, ruleLines, tokenizeRule, type RuleLine, type RuleMatcher } from './rule-syntax.js';

export type FingerprintRule = { readonly matchers: readonly RuleMatcher[]; readonly values: readonly string[] };

const MATCHER_KEYS = ['type', 'value', 'message', 'module', 'function', 'path', 'level', 'logger'] as const;
const FRAME_KEYS: readonly string[] = ['module', 'function', 'path'];
const ARROW = '->';
const TAG_PREFIX = 'tags.';

// --- parsing: helpers ---

/** The index of the first arrow outside double quotes, or -1. */
function arrowIndex(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === '\\' && quoted) i++;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && text.startsWith(ARROW, i)) return i;
  }
  return -1;
}

function parseMatchers(text: string): readonly RuleMatcher[] | Refusal {
  const tokens = tokenizeRule(text);
  if (isRefusal(tokens)) return tokens;
  const matchers: RuleMatcher[] = [];
  for (const token of tokens) {
    const matcher = parseMatcher({ token, keys: MATCHER_KEYS, tagsAllowed: true });
    if (isRefusal(matcher)) return matcher;
    matchers.push(matcher);
  }
  return matchers.length === 0 ? refusal('no matcher') : matchers;
}

function parseValues(text: string): readonly string[] | Refusal {
  if (text.trim() === '') return refusal('no value');
  const values = text.split(',').map((value) => value.trim());
  return values.includes('') ? refusal('empty value') : values;
}

function parseRuleLine(line: RuleLine): FingerprintRule | Refusal {
  const arrow = arrowIndex(line.text);
  if (arrow < 0) return refusal(`missing "${ARROW}"`);
  const matchers = parseMatchers(line.text.slice(0, arrow));
  if (isRefusal(matchers)) return matchers;
  const values = parseValues(line.text.slice(arrow + ARROW.length));
  if (isRefusal(values)) return values;
  return { matchers, values };
}

// --- matching: predicates ---

function isFrameMatcher(matcher: RuleMatcher): boolean {
  return FRAME_KEYS.includes(matcher.key);
}

function anyMatches({ glob, values }: { glob: string; values: readonly (string | null | undefined)[] }): boolean {
  return values.some((value) => typeof value === 'string' && globMatches({ glob, value }));
}

// --- matching: helpers ---

function frameValues({ key, frame }: { key: string; frame: GroupingFrame }): readonly (string | undefined)[] {
  if (key === 'module') return [frame.module];
  if (key === 'function') return [frame.function];
  return [frame.absPath, frame.filename].map((path) => path?.replace(/\\/g, '/'));
}

function eventValues({ key, input }: { key: string; input: GroupingInput }): readonly (string | null | undefined)[] {
  const exceptionValues = input.exceptions.map((exception) => exception.value);
  if (key === 'type') return input.exceptions.map((exception) => exception.type);
  if (key === 'value') return exceptionValues;
  if (key === 'message') return [input.message?.formatted, input.message?.template, ...exceptionValues];
  if (key === 'level') return [input.level];
  if (key === 'logger') return [input.logger];
  return [input.tags[key.slice(TAG_PREFIX.length)]];
}

function allFrames(input: GroupingInput): readonly GroupingFrame[] {
  return [...input.exceptions.flatMap((exception) => exception.frames), ...(input.stacktrace ?? [])];
}

function frameMatchesAll({ matchers, frame }: { matchers: readonly RuleMatcher[]; frame: GroupingFrame }): boolean {
  return matchers.every((matcher) => anyMatches({ glob: matcher.glob, values: frameValues({ key: matcher.key, frame }) }));
}

function ruleMatches({ rule, input }: { rule: FingerprintRule; input: GroupingInput }): boolean {
  const frameMatchers = rule.matchers.filter(isFrameMatcher);
  const eventMatchers = rule.matchers.filter((matcher) => !isFrameMatcher(matcher));
  const eventMatched = eventMatchers.every((matcher) =>
    anyMatches({ glob: matcher.glob, values: eventValues({ key: matcher.key, input }) }),
  );
  if (!eventMatched) return false;
  return frameMatchers.length === 0 || allFrames(input).some((frame) => frameMatchesAll({ matchers: frameMatchers, frame }));
}

// --- exports ---

export function parseFingerprintRules(text: string): readonly FingerprintRule[] | Refusal {
  const rules: FingerprintRule[] = [];
  for (const line of ruleLines(text)) {
    const rule = parseRuleLine(line);
    if (isRefusal(rule)) return refusal(`fingerprint rule line ${line.number}: ${rule.refusal}`);
    rules.push(rule);
  }
  return rules;
}

export function matchingFingerprintRule({
  input,
  rules,
}: {
  input: GroupingInput;
  rules: readonly FingerprintRule[];
}): FingerprintRule | null {
  return rules.find((rule) => ruleMatches({ rule, input })) ?? null;
}
