/**
 * Spam Judge verdict and its threshold (design Reports, Spam; Parameters,
 * Spam Judge threshold; the decision-models DecisionPort). The judge answers
 * spam, not spam, or abstains, with the probability it gives its answer; an
 * adapter that cannot score reports no confidence. Whether a verdict archives
 * a Report is decided here, against the threshold, and nowhere else.
 */

export type SpamVerdict = {
  readonly verdict: 'spam' | 'not_spam' | 'abstain';
  /** The probability of the verdict, 0 to 1; null from an adapter that cannot score (uncalibrated). */
  readonly confidence: number | null;
};

// --- predicates ---

/** True when the verdict archives the Report: spam, calibrated, and at or above the threshold. */
export function isJudgedSpam(verdict: SpamVerdict, threshold: number): boolean {
  return verdict.verdict === 'spam' && verdict.confidence !== null && verdict.confidence >= threshold;
}
