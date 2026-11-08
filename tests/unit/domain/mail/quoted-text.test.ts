import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { replyText } from '../../../../src/domain/mail/quoted-text.js';

describe('replyText', () => {
  it('keeps what the replier wrote above the quoted notification', () => {
    const text = [
      'Looking at it now.',
      'Probably the cart.',
      '',
      'On Mon, Nov 2, 2026 at 10:00 Nightwatch wrote:',
      '> Issue issue-1 changed',
      '> status',
    ].join('\n');
    expect(replyText(text)).toBe('Looking at it now.\nProbably the cart.');
  });

  it('drops quoted lines anywhere and a trailing signature', () => {
    expect(replyText('> quoted\nmine\n-- \nMia')).toBe('mine');
  });

  it('normalises line endings and trims', () => {
    expect(replyText('  fixed in 1.2\r\n\r\n')).toBe('fixed in 1.2');
  });

  it('is idempotent and never longer than its input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = replyText(text);
        expect(replyText(once)).toBe(once);
        expect(once.length).toBeLessThanOrEqual(text.length);
      }),
    );
  });
});
