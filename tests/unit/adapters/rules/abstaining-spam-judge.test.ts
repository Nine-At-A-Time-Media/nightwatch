// AbstainingSpamJudge: the SpamJudge a runtime gets while no rules are
// configured. It abstains with no confidence, so no Report is ever archived
// as spam by it.
import { describe, expect, it } from 'vitest';
import { AbstainingSpamJudge } from '../../../../src/adapters/rules/abstaining-spam-judge.js';
import { isJudgedSpam } from '../../../../src/domain/report/spam.js';
import type { SpamJudge } from '../../../../src/ports/spam-judge.js';

describe('AbstainingSpamJudge', () => {
  it('abstains with no confidence, which never archives a Report', async () => {
    const judge: SpamJudge = new AbstainingSpamJudge();
    const verdict = await judge.judge('BUY NOW http://spam.example');
    expect(verdict).toEqual({ verdict: 'abstain', confidence: null });
    expect(isJudgedSpam(verdict, 0)).toBe(false);
  });
});
