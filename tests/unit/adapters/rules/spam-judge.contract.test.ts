// SpamJudge contract: every SpamJudge answers a well-formed SpamVerdict --
// spam, not spam or abstain, with a probability from 0 to 1 or none -- for
// any message, and answers the same message the same way. The rules judge
// (the day-one adapter) also keeps its own rules: a message dense with links,
// or with a long run of one repeated character, is spam; ordinary prose is not.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RulesSpamJudge } from '../../../../src/adapters/rules/rules-spam-judge.js';
import { isJudgedSpam, type SpamVerdict } from '../../../../src/domain/report/spam.js';
import type { SpamJudge } from '../../../../src/ports/spam-judge.js';
import { FakeSpamJudge } from '../../../_fakes/fake-spam-judge.js';

const THRESHOLD = 0.9;

function isWellFormed(verdict: SpamVerdict): boolean {
  const known = verdict.verdict === 'spam' || verdict.verdict === 'not_spam' || verdict.verdict === 'abstain';
  const confidence = verdict.confidence === null || (verdict.confidence >= 0 && verdict.confidence <= 1);
  return known && confidence;
}

describe.each<{ name: string; make: () => SpamJudge }>([
  { name: 'FakeSpamJudge', make: () => new FakeSpamJudge() },
  { name: 'RulesSpamJudge', make: () => new RulesSpamJudge() },
])('SpamJudge contract -- $name', ({ make }) => {
  it('answers a well-formed verdict for any message', async () => {
    const judge = make();
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 500 }), async (message) => isWellFormed(await judge.judge(message))));
  });

  it('answers the same message the same way', async () => {
    const judge = make();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (message) => {
        expect(await judge.judge(message)).toEqual(await judge.judge(message));
      }),
    );
  });
});

describe('RulesSpamJudge', () => {
  const judge = new RulesSpamJudge();

  it('ordinary prose about a bug is not spam', async () => {
    const verdict = await judge.judge('The checkout page froze after I pressed Pay. See https://shop.example/cart for my cart.');
    expect(verdict.verdict).toBe('not_spam');
    expect(isJudgedSpam(verdict, THRESHOLD)).toBe(false);
  });

  it('a message that is mostly links is spam, above the threshold', async () => {
    const verdict = await judge.judge('cheap https://a.example https://b.example www.c.example https://d.example buy');
    expect(verdict.verdict).toBe('spam');
    expect(isJudgedSpam(verdict, THRESHOLD)).toBe(true);
  });

  it('a long run of one repeated character is spam, above the threshold', async () => {
    const verdict = await judge.judge('help!!!!!!!!!!!!!!!!!!!!!!!!');
    expect(verdict.verdict).toBe('spam');
    expect(isJudgedSpam(verdict, THRESHOLD)).toBe(true);
  });

  it('a short run of a repeated character is not spam', async () => {
    expect((await judge.judge('Hmmm... it crashed!!! Again.')).verdict).toBe('not_spam');
  });

  it('two links in a long message are not spam', async () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    expect((await judge.judge(`${words} https://a.example https://b.example`)).verdict).toBe('not_spam');
  });

  it('a message both rules match is spam with more confidence than one either rule matches', async () => {
    const one = await judge.judge('https://a.example https://b.example https://c.example');
    const both = await judge.judge('https://a.example https://b.example https://c.example zzzzzzzzzzzzzzzzzzzz');
    expect(both.confidence!).toBeGreaterThan(one.confidence!);
  });
});
