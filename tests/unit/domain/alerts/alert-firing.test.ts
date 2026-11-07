import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alertFiring, recordDelivery, undeliveredActions } from '../../../../src/domain/alerts/alert-firing.js';
import type { Action, IssueAlertRule } from '../../../../src/domain/alerts/issue-alert-rule.js';
import { T0 } from '../issue/fixtures.js';

const email: Action = { kind: 'email', to: { kind: 'owners' } };
const webhook: Action = { kind: 'webhook', url: 'https://hooks.example.com/nightwatch' };

const rule: IssueAlertRule = {
  ruleId: 'rule-1',
  triggers: [{ kind: 'first_seen' }],
  actionMatch: 'any',
  filters: [],
  filterMatch: 'all',
  actions: [email, webhook],
  quietPeriodMs: 60_000,
};

describe('Alert Firing', () => {
  it('starts with every action of the rule pending', () => {
    expect(alertFiring({ rule, issueId: 'issue-1', at: T0 })).toEqual({
      ruleId: 'rule-1',
      issueId: 'issue-1',
      at: T0,
      deliveries: [
        { action: email, status: 'pending' },
        { action: webhook, status: 'pending' },
      ],
    });
  });

  it('Undelivered alert is visible: Given an Issue Alert Rule whose email or webhook action cannot be delivered, When Nightwatch stops trying, Then Members see on the rule that the action was not delivered', () => {
    const firing = recordDelivery(recordDelivery(alertFiring({ rule, issueId: 'issue-1', at: T0 }), 0, 'delivered'), 1, 'undelivered');
    expect(undeliveredActions(firing)).toEqual([webhook]);
  });

  it('a delivery recorded for an action the firing does not hold changes nothing', () => {
    const firing = alertFiring({ rule, issueId: 'issue-1', at: T0 });
    expect(recordDelivery(firing, 5, 'undelivered')).toEqual(firing);
  });

  it('lists exactly the actions recorded undelivered', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('pending', 'delivered', 'undelivered' as const), { minLength: 2, maxLength: 2 }), (statuses) => {
        const firing = statuses.reduce(
          (acc, status, index) => recordDelivery(acc, index, status),
          alertFiring({ rule, issueId: 'issue-1', at: T0 }),
        );
        expect(undeliveredActions(firing)).toHaveLength(statuses.filter((status) => status === 'undelivered').length);
      }),
    );
  });
});
