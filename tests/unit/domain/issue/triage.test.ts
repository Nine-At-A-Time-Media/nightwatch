// Triage actions: the one name for every member command the console offers
// (design State Machine: Issue, rows triggered by a member), dispatched to
// the issue commands, and read from a request body.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { archive, markReviewed, resolve, setPriority, unarchive, unresolve } from '../../../../src/domain/issue/commands.js';
import type { Status } from '../../../../src/domain/issue/state.js';
import { parseTriageAction, triage, type TriageAction } from '../../../../src/domain/issue/triage.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { HOUR, T0, issueArbitrary, issueIn, member } from './fixtures.js';

const AT = T0 + HOUR;
const ongoing: Status = { status: 'unresolved', substatus: 'ongoing' };
const resolved: Status = { status: 'resolved', resolution: { kind: 'plain' } };
const archivedForever: Status = { status: 'archived', substatus: 'forever', spam: false };

const ACTIONS: readonly TriageAction[] = [
  { kind: 'resolve', resolution: { kind: 'plain' } },
  { kind: 'resolve', resolution: { kind: 'in_release', release: '1.2.0' } },
  { kind: 'resolve', resolution: { kind: 'in_next_release' } },
  { kind: 'archive', archive: { substatus: 'until_escalating' } },
  {
    kind: 'archive',
    archive: { substatus: 'until_condition', condition: { untilDate: null, count: 10, window: null, userCount: null, userWindow: null } },
  },
  { kind: 'archive', archive: { substatus: 'forever' } },
  { kind: 'unarchive' },
  { kind: 'unresolve' },
  { kind: 'set_priority', level: 'low' },
  { kind: 'mark_reviewed' },
];

describe('triage', () => {
  it('resolve in next release resolves pending, with no release named yet', () => {
    const result = triage(issueIn(ongoing), { kind: 'resolve', resolution: { kind: 'in_next_release' } }, member, AT);
    expect(result).toEqual(resolve(issueIn(ongoing), { kind: 'in_next_release', release: null }, member, AT));
  });

  it('a Member archiving forever never marks the Issue as spam', () => {
    const result = triage(issueIn(ongoing), { kind: 'archive', archive: { substatus: 'forever' } }, member, AT);
    expect(result).toEqual(archive(issueIn(ongoing), { substatus: 'forever', spam: false }, member, AT));
  });

  it('each other action is the issue command of the same name', () => {
    const condition = { untilDate: null, count: 10, window: null, userCount: null, userWindow: null };
    expect(triage(issueIn(ongoing), { kind: 'resolve', resolution: { kind: 'in_release', release: '1.2.0' } }, member, AT)).toEqual(
      resolve(issueIn(ongoing), { kind: 'in_release', release: '1.2.0' }, member, AT),
    );
    expect(triage(issueIn(ongoing), { kind: 'archive', archive: { substatus: 'until_condition', condition } }, member, AT)).toEqual(
      archive(issueIn(ongoing), { substatus: 'until_condition', condition }, member, AT),
    );
    expect(triage(issueIn(archivedForever), { kind: 'unarchive' }, member, AT)).toEqual(unarchive(issueIn(archivedForever), member, AT));
    expect(triage(issueIn(resolved), { kind: 'unresolve' }, member, AT)).toEqual(unresolve(issueIn(resolved), member, AT));
    expect(triage(issueIn(ongoing), { kind: 'set_priority', level: 'low' }, member, AT)).toEqual(
      setPriority(issueIn(ongoing), 'low', member, AT),
    );
    expect(triage(issueIn(ongoing), { kind: 'mark_reviewed' }, member, AT)).toEqual(markReviewed(issueIn(ongoing), member, AT));
  });

  it('refuses a transition the State Machine does not allow, and a condition that names nothing', () => {
    expect(triage(issueIn(resolved), { kind: 'unarchive' }, member, AT)).toEqual({ refusal: 'transition_not_allowed' });
    const nothing = { untilDate: null, count: null, window: null, userCount: null, userWindow: null };
    expect(
      triage(issueIn(ongoing), { kind: 'archive', archive: { substatus: 'until_condition', condition: nothing } }, member, AT),
    ).toEqual({
      refusal: 'condition_required',
    });
  });

  it('property: every action either refuses or leaves the Issue out of For Review', () => {
    fc.assert(
      fc.property(issueArbitrary, fc.constantFrom(...ACTIONS), (state, action) => {
        const result = triage(state, action, member, AT);
        return isRefusal(result) || result.state.forReviewSince === null;
      }),
    );
  });
});

describe('parseTriageAction', () => {
  it('reads every action from its JSON form', () => {
    for (const action of ACTIONS) expect(parseTriageAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
  });

  it('refuses an unknown kind, a missing release, an unknown Priority and a body that is not an object', () => {
    const invalid = { refusal: 'invalid_triage_action' };
    expect(parseTriageAction({ kind: 'delete' })).toEqual(invalid);
    expect(parseTriageAction({ kind: 'resolve', resolution: { kind: 'in_release' } })).toEqual(invalid);
    expect(parseTriageAction({ kind: 'set_priority', level: 'urgent' })).toEqual(invalid);
    expect(parseTriageAction(null)).toEqual(invalid);
  });

  it('property: arbitrary input never throws; it parses or refuses', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        const parsed = parseTriageAction(input);
        return isRefusal(parsed) || ACTIONS.some((action) => action.kind === parsed.kind);
      }),
    );
  });
});
