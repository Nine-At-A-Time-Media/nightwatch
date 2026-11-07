/**
 * SpamJudge -- the seam for spam judgement (architecture Seams: Spam
 * judgement; the decision-models DecisionPort). Rules on day one, a Workers
 * AI classifier as the second mechanism. It judges a Report's message and
 * answers a SpamVerdict; whether that archives the Report is the domain's
 * threshold rule, never the adapter's. An adapter that cannot reach its
 * model answers `abstain`, so a failure never takes the path spam would.
 */

import type { SpamVerdict } from '../domain/report/spam.js';

export interface SpamJudge {
  judge(message: string): Promise<SpamVerdict>;
}
