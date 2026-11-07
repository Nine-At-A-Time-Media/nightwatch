// The notifier's fan-out: one Issue Change becomes one step message per piece
// of work it starts, so each step succeeds or retries on its own. Owners are
// suggested only for a new Issue.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { isNewIssue, isNotifierStep, NOTIFIER_STEPS, stepMessagesOf, stepsFor } from '../../../../src/workers/notifier/steps.js';

const OPENED: IssueChange = {
  issueId: 'i1',
  kind: 'status',
  from: null,
  to: 'unresolved/new',
  actor: 'system',
  origin: 'nightwatch',
  at: 1,
};
const RESOLVED: IssueChange = { ...OPENED, from: 'unresolved/new', to: 'resolved' };

const change: fc.Arbitrary<IssueChange> = fc.record({
  issueId: fc.string({ minLength: 1 }),
  kind: fc.constantFrom('status', 'priority', 'resolution', 'for_review', 'merge', 'split', 'comment', 'assignee'),
  from: fc.option(fc.constantFrom('unresolved/new', 'resolved', 'archived/forever'), { nil: null }),
  to: fc.option(fc.constantFrom('unresolved/new', 'resolved', 'in'), { nil: null }),
  actor: fc.constantFrom('system', 'tracker', 'reporter'),
  origin: fc.constantFrom('nightwatch', 'tracker'),
  at: fc.nat(),
});

describe('notifier fan-out', () => {
  it('a new Issue starts every step, owner suggestion included', () => {
    expect(isNewIssue(OPENED)).toBe(true);
    expect(stepsFor(OPENED)).toEqual([...NOTIFIER_STEPS]);
  });

  it('any other change starts every step but owner suggestion', () => {
    expect(isNewIssue(RESOLVED)).toBe(false);
    expect(stepsFor(RESOLVED)).toEqual(['notifyReporters', 'notifyFollowers', 'evaluateIssueAlerts', 'pushIssueChange']);
  });

  it('every step message carries the change and its Project, one per step, each a step the notifier knows', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), change, (projectId, sent) => {
        const messages = stepMessagesOf({ projectId, change: sent });
        expect(messages.map((message) => message.step)).toEqual(stepsFor(sent));
        expect(
          messages.every((message) => message.projectId === projectId && message.change === sent && isNotifierStep(message.step)),
        ).toBe(true);
        expect(new Set(messages.map((message) => message.step)).size).toBe(messages.length);
      }),
    );
  });

  it('a step name the notifier does not know is not a step', () => {
    expect(isNotifierStep('sendFax')).toBe(false);
  });
});
