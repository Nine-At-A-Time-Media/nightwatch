import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sharedCommentText } from '../../../../src/domain/tracker/share-marker.js';

const MARKER = '/reporter';
const marker = fc.stringMatching(/^[^\s][^\r\n]{0,15}$/).filter((m) => m.trim() === m);
const text = fc.string({ minLength: 1 }).filter((t) => t.trim() !== '');

describe('Share marker', () => {
  it('Shared GitHub comment: Given a comment whose first line is the share marker, Then the rest of it is the shared text', () => {
    expect(sharedCommentText(`${MARKER}\nThanks, fixed in 1.2.0.`, MARKER)).toBe('Thanks, fixed in 1.2.0.');
    expect(sharedCommentText(`  ${MARKER}  \r\n\nLine one\nLine two\n`, MARKER)).toBe('Line one\nLine two');
  });

  it('Shared GitHub comment: a comment without the marker on its own first line is not shared', () => {
    expect(sharedCommentText('Thanks, fixed.', MARKER)).toBeNull();
    expect(sharedCommentText(`${MARKER} Thanks, fixed.`, MARKER)).toBeNull();
    expect(sharedCommentText(`Note\n${MARKER}\nThanks`, MARKER)).toBeNull();
    expect(sharedCommentText(`${MARKER.toUpperCase()}\nThanks`, MARKER)).toBeNull();
  });

  it('Shared GitHub comment: a marker with nothing after it, or a blank marker, shares nothing', () => {
    expect(sharedCommentText(`${MARKER}\n  \n`, MARKER)).toBeNull();
    expect(sharedCommentText(MARKER, MARKER)).toBeNull();
    expect(sharedCommentText('\nThanks', '')).toBeNull();
    expect(sharedCommentText('  \nThanks', '  ')).toBeNull();
  });

  it('any marker on its own first line shares exactly the text after it', () => {
    fc.assert(
      fc.property(marker, text, (m, t) => {
        expect(sharedCommentText(`${m}\n${t}`, m)).toBe(t.trim());
      }),
    );
  });

  it('a comment whose first line is not the marker is never shared', () => {
    fc.assert(
      fc.property(marker, fc.string(), (m, body) => {
        const firstLine = body.split(/\r\n|\r|\n/)[0] ?? '';
        fc.pre(firstLine.trim() !== m);
        expect(sharedCommentText(body, m)).toBeNull();
      }),
    );
  });
});
