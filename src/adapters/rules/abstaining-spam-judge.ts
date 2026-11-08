/**
 * AbstainingSpamJudge -- the SpamJudge a runtime is given while it has no
 * spam rules (architecture Seams: Spam judgement). It abstains with no
 * confidence, so by the domain's threshold rule it never archives a Report:
 * an unjudged Report takes the path a Report that is not spam takes.
 */

import type { SpamVerdict } from '../../domain/report/spam.js';
import type { SpamJudge } from '../../ports/spam-judge.js';

const ABSTAIN: SpamVerdict = { verdict: 'abstain', confidence: null };

// --- exports ---

export class AbstainingSpamJudge implements SpamJudge {
  async judge(): Promise<SpamVerdict> {
    return ABSTAIN;
  }
}
