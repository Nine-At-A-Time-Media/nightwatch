import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isReplyTokenLive,
  parseReplyAddress,
  replyAddress,
  replyTokenOf,
  replyTokenText,
  threadHeaders,
  type ReplyToken,
} from '../../../../src/domain/mail/reply-address.js';

const TOKEN: ReplyToken = { projectId: 'project-1', issueId: 'issue-1', member: 'member-mia', expiresAt: 5_000 };

describe('reply address', () => {
  it('writes the token text and signature into a reply+ address and reads them back', () => {
    const text = replyTokenText(TOKEN);
    const address = replyAddress({ text, signature: 'c2ln', domain: 'reply.example' });
    expect(address).toMatch(/^reply\+[A-Za-z0-9_-]+\.c2ln@reply\.example$/);
    expect(parseReplyAddress(address)).toEqual({ text, signature: 'c2ln' });
    expect(replyTokenOf(text)).toEqual(TOKEN);
  });

  it('reads an address in angle brackets with a display name, in any case of the domain', () => {
    const text = replyTokenText(TOKEN);
    expect(parseReplyAddress(`Nightwatch <reply+${text}.c2ln@Reply.Example>`)).toEqual({ text, signature: 'c2ln' });
  });

  it('reads nothing from an address that is not a reply address or whose token is malformed', () => {
    expect(parseReplyAddress('mia@acme.example')).toBeNull();
    expect(parseReplyAddress('reply+nodot@reply.example')).toBeNull();
    expect(replyTokenOf('not base64 !')).toBeNull();
    expect(replyTokenOf(btoa('only\u0000two'))).toBeNull();
    expect(replyTokenOf(btoa('a\u0000b\u0000c\u0000soon'))).toBeNull();
  });

  it('round-trips any token', () => {
    const part = fc.string({ minLength: 1 }).filter((s) => !s.includes('\u0000'));
    fc.assert(
      fc.property(part, part, part, fc.nat(), (projectId, issueId, member, expiresAt) => {
        const token = { projectId, issueId, member, expiresAt };
        const address = replyAddress({ text: replyTokenText(token), signature: 'sig', domain: 'reply.example' });
        const parsed = parseReplyAddress(address);
        expect(parsed).not.toBeNull();
        expect(replyTokenOf(parsed?.text ?? '')).toEqual(token);
      }),
    );
  });

  it('is live until its expiry', () => {
    expect(isReplyTokenLive(TOKEN, 4_999)).toBe(true);
    expect(isReplyTokenLive(TOKEN, 5_000)).toBe(false);
  });

  it('threads every mail about one Issue under one key', () => {
    const one = threadHeaders({ projectId: 'project-1', issueId: 'issue-1', domain: 'mail.example' });
    expect(one).toEqual({ 'In-Reply-To': '<issue.project-1.issue-1@mail.example>', References: '<issue.project-1.issue-1@mail.example>' });
    expect(threadHeaders({ projectId: 'project-1', issueId: 'issue-2', domain: 'mail.example' })).not.toEqual(one);
  });
});
