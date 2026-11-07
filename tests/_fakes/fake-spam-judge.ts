// FakeSpamJudge -- SpamJudge that answers one set verdict and keeps every message it judged.
import type { SpamVerdict } from '../../src/domain/report/spam.js';
import type { SpamJudge } from '../../src/ports/spam-judge.js';

export class FakeSpamJudge implements SpamJudge {
  readonly judged: string[] = [];
  verdict: SpamVerdict = { verdict: 'not_spam', confidence: 0.99 };

  async judge(message: string): Promise<SpamVerdict> {
    this.judged.push(message);
    return this.verdict;
  }
}
