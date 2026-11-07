/**
 * Stack Trace Rules -- a Project's rules that mark frames in-app or
 * out-of-app and exclude frames from grouping. One rule per line:
 *
 *   matcher:glob [matcher:glob ...] action [action ...]
 *
 * Matchers: path (absolute path, else file name), module, function, family
 * (the event platform's family: native, javascript or other). A rule matches
 * a frame when every matcher does. Actions: +app and -app set in-app, -group
 * excludes the frame from grouping. Rules apply in order, so for in-app the
 * last matching rule wins; -group, once applied, stays. A frame no rule marks
 * keeps the SDK's in-app flag, absent meaning out-of-app.
 */

import { isRefusal, refusal, type Refusal } from '../refusal.js';
import type { GroupingFrame } from './grouping-input.js';
import { globMatches, parseMatcher, ruleLines, tokenizeRule, type RuleLine, type RuleMatcher } from './rule-syntax.js';

export type StackTraceAction = '+app' | '-app' | '-group';

export type StackTraceRule = { readonly matchers: readonly RuleMatcher[]; readonly actions: readonly StackTraceAction[] };

/** A frame after Stack Trace Rules: whether it is in-app and whether it takes part in grouping. */
export type RuledFrame = { readonly frame: GroupingFrame; readonly inApp: boolean; readonly grouped: boolean };

export type PlatformFamily = 'native' | 'javascript' | 'other';

const MATCHER_KEYS = ['path', 'module', 'function', 'family'] as const;
const ACTIONS: readonly StackTraceAction[] = ['+app', '-app', '-group'];
const NATIVE_PLATFORMS = ['native', 'c', 'cpp', 'cocoa', 'objc', 'swift', 'rust'];
const JAVASCRIPT_PLATFORMS = ['javascript', 'node'];

// --- parsing: predicates ---

function isActionToken(token: string): boolean {
  return token.startsWith('+') || token.startsWith('-');
}

function isStackTraceAction(token: string): token is StackTraceAction {
  return (ACTIONS as readonly string[]).includes(token);
}

// --- parsing: helpers ---

function parseRuleLine(line: RuleLine): StackTraceRule | Refusal {
  const tokens = tokenizeRule(line.text);
  if (isRefusal(tokens)) return tokens;
  const matchers: RuleMatcher[] = [];
  const actions: StackTraceAction[] = [];
  for (const token of tokens) {
    if (isActionToken(token)) {
      if (!isStackTraceAction(token)) return refusal(`unknown action "${token}"`);
      actions.push(token);
    } else {
      const matcher = parseMatcher({ token, keys: MATCHER_KEYS, tagsAllowed: false });
      if (isRefusal(matcher)) return matcher;
      matchers.push(matcher);
    }
  }
  if (matchers.length === 0) return refusal('no matcher');
  if (actions.length === 0) return refusal('no action');
  if (actions.includes('+app') && actions.includes('-app')) return refusal('both +app and -app');
  return { matchers, actions };
}

// --- applying: helpers ---

function platformFamily(platform: string): PlatformFamily {
  if (NATIVE_PLATFORMS.includes(platform)) return 'native';
  if (JAVASCRIPT_PLATFORMS.includes(platform)) return 'javascript';
  return 'other';
}

function frameValues({
  matcher,
  frame,
  family,
}: {
  matcher: RuleMatcher;
  frame: GroupingFrame;
  family: PlatformFamily;
}): readonly string[] {
  if (matcher.key === 'path') return [frame.absPath, frame.filename].filter((v) => v !== undefined).map((v) => v.replace(/\\/g, '/'));
  if (matcher.key === 'module') return frame.module === undefined ? [] : [frame.module];
  if (matcher.key === 'function') return frame.function === undefined ? [] : [frame.function];
  return [family];
}

function ruleMatchesFrame({ rule, frame, family }: { rule: StackTraceRule; frame: GroupingFrame; family: PlatformFamily }): boolean {
  return rule.matchers.every((matcher) =>
    frameValues({ matcher, frame, family }).some((value) => globMatches({ glob: matcher.glob, value })),
  );
}

function ruleFrame({
  frame,
  family,
  rules,
}: {
  frame: GroupingFrame;
  family: PlatformFamily;
  rules: readonly StackTraceRule[];
}): RuledFrame {
  return rules
    .filter((rule) => ruleMatchesFrame({ rule, frame, family }))
    .flatMap((rule) => rule.actions)
    .reduce<RuledFrame>((ruled, action) => (action === '-group' ? { ...ruled, grouped: false } : { ...ruled, inApp: action === '+app' }), {
      frame,
      inApp: frame.inApp ?? false,
      grouped: true,
    });
}

// --- exports ---

export function parseStackTraceRules(text: string): readonly StackTraceRule[] | Refusal {
  const rules: StackTraceRule[] = [];
  for (const line of ruleLines(text)) {
    const rule = parseRuleLine(line);
    if (isRefusal(rule)) return refusal(`stack trace rule line ${line.number}: ${rule.refusal}`);
    rules.push(rule);
  }
  return rules;
}

export function applyStackTraceRules({
  frames,
  platform,
  rules,
}: {
  frames: readonly GroupingFrame[];
  platform: string;
  rules: readonly StackTraceRule[];
}): readonly RuledFrame[] {
  const family = platformFamily(platform);
  return frames.map((frame) => ruleFrame({ frame, family, rules }));
}
