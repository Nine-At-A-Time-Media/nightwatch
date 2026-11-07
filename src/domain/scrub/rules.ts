/**
 * Scrubbing Rules -- what is removed from an Event before it is stored or
 * shown (design Processing, Scrubbing; Security, secrets and personal data).
 * The built-in set removes credentials by key name, card numbers that pass
 * the Luhn check, and bearer tokens; IP addresses are removed when the
 * Project asks. Project rules select fields by path glob and run before the
 * built-in set. Values only; scrub.ts applies them.
 */

import { z } from 'zod';
import { refusal, type Refusal } from '../refusal.js';

export type ScrubMethod = 'remove' | 'mask' | 'hash' | 'replace';

export type ValuePattern = 'credit-card' | 'bearer-token' | 'ip-address';

/** A rule a Project sets: a field path glob (`.` between segments, `*` within one, `**` across any number). */
export type ProjectScrubbingRule = {
  readonly name: string;
  readonly selector: string;
  readonly method: ScrubMethod;
  readonly replacement?: string;
};

/** Rules that remove a whole field: by path glob, or by a word in its key. */
export type FieldRule =
  | {
      readonly kind: 'selector';
      readonly name: string;
      readonly method: ScrubMethod;
      readonly replacement?: string;
      readonly selector: string;
    }
  | { readonly kind: 'key'; readonly name: string; readonly method: ScrubMethod; readonly words: readonly string[] };

/** Rules that remove matching text inside any field. */
export type PatternRule = { readonly name: string; readonly method: ScrubMethod; readonly pattern: ValuePattern };

export type ScrubbingRules = { readonly fields: readonly FieldRule[]; readonly patterns: readonly PatternRule[] };

/** Words that mark a key as holding a credential, compared without case or separators. */
const SENSITIVE_WORDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'privatekey',
  'sessionid',
  'csrf',
] as const;

const SENSITIVE_KEY_RULE: FieldRule = { kind: 'key', name: 'built-in:sensitive-key', method: 'replace', words: SENSITIVE_WORDS };
const CREDIT_CARD_RULE: PatternRule = { name: 'built-in:credit-card', method: 'mask', pattern: 'credit-card' };
const BEARER_TOKEN_RULE: PatternRule = { name: 'built-in:bearer-token', method: 'replace', pattern: 'bearer-token' };
const IP_ADDRESS_RULE: PatternRule = { name: 'built-in:ip-address', method: 'replace', pattern: 'ip-address' };

const projectRuleSchema = z.array(
  z.object({
    name: z.string().min(1),
    selector: z.string().min(1),
    method: z.enum(['remove', 'mask', 'hash', 'replace']),
    replacement: z.string().optional(),
  }),
);

// --- helpers ---

function selectorRule(rule: ProjectScrubbingRule): FieldRule {
  const base = { kind: 'selector', name: rule.name, method: rule.method, selector: rule.selector } as const;
  return rule.replacement === undefined ? base : { ...base, replacement: rule.replacement };
}

// --- exports ---

/** The Project's rules first, then the built-in set; `ipAddresses` turns on the IP address rule. */
export function scrubbingRules(settings: { ipAddresses: boolean; project: readonly ProjectScrubbingRule[] }): ScrubbingRules {
  return {
    fields: [...settings.project.map(selectorRule), SENSITIVE_KEY_RULE],
    patterns: [CREDIT_CARD_RULE, BEARER_TOKEN_RULE, ...(settings.ipAddresses ? [IP_ADDRESS_RULE] : [])],
  };
}

/** Validates a Project's stored Scrubbing Rules. */
export function parseScrubbingRules(raw: unknown): readonly ProjectScrubbingRule[] | Refusal {
  const result = projectRuleSchema.safeParse(raw);
  if (!result.success) return refusal('invalid-scrubbing-rules');
  return result.data.map(({ replacement, ...rule }) => (replacement === undefined ? rule : { ...rule, replacement }));
}
