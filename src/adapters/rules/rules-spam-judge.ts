/**
 * RulesSpamJudge -- the day-one SpamJudge (architecture Seams: Spam
 * judgement; the local stage's stand-in for the Workers AI classifier).
 * Deterministic rules over the message text: a message dense with links, or
 * carrying a long run of one repeated character, is spam. Each matching rule
 * raises the confidence; a message no rule matches is not spam, with no
 * confidence, since rules cannot score it. Whether a verdict archives a
 * Report is the domain's threshold rule, not this adapter's.
 */

import type { SpamVerdict } from '../../domain/report/spam.js';
import type { SpamJudge } from '../../ports/spam-judge.js';

/** A link: an http(s) URL or a bare www. host. */
const LINK = /^(?:https?:\/\/|www\.)\S+/i;
/** At least this many links, making up at least this share of the words, is link spam. */
const MIN_LINKS = 3;
const MIN_LINK_SHARE = 0.25;
/** A run of one character this long, outside whitespace, is repetition spam. */
const REPEAT_RUN = /(\S)\1{11,}/u;
/** Confidence by the number of rules matched. */
const CONFIDENCE_BY_MATCHES: readonly number[] = [0, 0.95, 0.99];

const NOT_SPAM: SpamVerdict = { verdict: 'not_spam', confidence: null };

// --- predicates ---

function isLinkDense(message: string): boolean {
  const words = message.split(/\s+/).filter((word) => word.length > 0);
  const links = words.filter((word) => LINK.test(word)).length;
  return links >= MIN_LINKS && links / words.length >= MIN_LINK_SHARE;
}

function hasRepeatRun(message: string): boolean {
  return REPEAT_RUN.test(message);
}

// --- helpers ---

export function rulesVerdict(message: string): SpamVerdict {
  const matches = [isLinkDense(message), hasRepeatRun(message)].filter(Boolean).length;
  const confidence = CONFIDENCE_BY_MATCHES[matches];
  return matches === 0 || confidence === undefined ? NOT_SPAM : { verdict: 'spam', confidence };
}

// --- exports ---

export class RulesSpamJudge implements SpamJudge {
  async judge(message: string): Promise<SpamVerdict> {
    return rulesVerdict(message);
  }
}
