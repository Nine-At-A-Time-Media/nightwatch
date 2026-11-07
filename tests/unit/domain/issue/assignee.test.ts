import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assign, assigneeLabel } from '../../../../src/domain/issue/assignee.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { HOUR, T0, issueArbitrary, issueIn, member } from './fixtures.js';

const AT = T0 + HOUR;
const MIA = { member: 'member-mia' } as const;
const WEB = { team: 'web' } as const;

describe('assigneeLabel', () => {
  it('names a Member and a Team apart, so History tells them apart', () => {
    expect(assigneeLabel(MIA)).toBe('member:member-mia');
    expect(assigneeLabel(WEB)).toBe('team:web');
  });
});

describe('assign', () => {
  it("a Member's assignment records the Assignee change and takes the Issue out of For Review", () => {
    const state = issueIn({ status: 'unresolved', substatus: 'new' }, { forReviewSince: T0 });
    const result = assign(state, { from: null, to: MIA, actor: member, at: AT });
    if (isRefusal(result)) throw new Error(result.refusal);

    expect(result.state.forReviewSince).toBeNull();
    expect(result.changes).toEqual([
      { issueId: 'issue-1', kind: 'assignee', from: null, to: 'member:member-mia', actor: member, origin: 'nightwatch', at: AT },
      { issueId: 'issue-1', kind: 'for_review', from: 'in', to: null, actor: member, origin: 'nightwatch', at: AT },
    ]);
  });

  it('an assignment by Nightwatch itself (auto-assign) leaves For Review as it was', () => {
    const state = issueIn({ status: 'unresolved', substatus: 'new' }, { forReviewSince: T0 });
    const result = assign(state, { from: null, to: WEB, actor: 'system', at: AT });
    if (isRefusal(result)) throw new Error(result.refusal);

    expect(result.state.forReviewSince).toBe(T0);
    expect(result.changes.map((entry) => [entry.kind, entry.from, entry.to])).toEqual([['assignee', null, 'team:web']]);
  });

  it('unassigning records the change to none; assigning the same Assignee again records no Assignee change', () => {
    const state = issueIn({ status: 'unresolved', substatus: 'ongoing' });
    const cleared = assign(state, { from: MIA, to: null, actor: member, at: AT });
    const same = assign(state, { from: MIA, to: { member: 'member-mia' }, actor: member, at: AT });
    if (isRefusal(cleared) || isRefusal(same)) throw new Error('refused');

    expect(cleared.changes.map((entry) => [entry.kind, entry.from, entry.to])).toEqual([['assignee', 'member:member-mia', null]]);
    expect(same.changes).toEqual([]);
  });

  it('refuses an Issue being deleted or merged away', () => {
    expect(assign(issueIn({ status: 'deleting' }), { from: null, to: MIA, actor: member, at: AT })).toEqual({ refusal: 'issue_deleting' });
    expect(assign(issueIn({ status: 'merging' }), { from: null, to: MIA, actor: member, at: AT })).toEqual({ refusal: 'issue_merging' });
  });

  it('never changes Status, and a Member always leaves the Issue out of For Review', () => {
    fc.assert(
      fc.property(issueArbitrary, fc.option(fc.constantFrom(MIA, WEB), { nil: null }), (state, to) => {
        const result = assign(state, { from: null, to, actor: member, at: AT });
        if (isRefusal(result)) return state.status === 'deleting' || state.status === 'merging';
        return result.state.status === state.status && result.state.forReviewSince === null;
      }),
    );
  });
});
