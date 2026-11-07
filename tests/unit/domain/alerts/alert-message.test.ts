import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alertFiring } from '../../../../src/domain/alerts/alert-firing.js';
import {
  alertMessageOf,
  digestMailOf,
  frequencyWindows,
  incidentMessageOf,
  issueKindOf,
  workflowMailOf,
} from '../../../../src/domain/alerts/alert-message.js';
import { emptyDigest, gather } from '../../../../src/domain/alerts/digest.js';
import type { IssueAlertRule } from '../../../../src/domain/alerts/issue-alert-rule.js';
import { latestReleaseOf } from '../../../../src/domain/release/ordering.js';
import { MINUTE, T0 } from '../issue/fixtures.js';

const rule: IssueAlertRule = {
  ruleId: 'rule-1',
  triggers: [{ kind: 'first_seen' }],
  actionMatch: 'any',
  filters: [],
  filterMatch: 'all',
  actions: [{ kind: 'webhook', url: 'https://hooks.example/a' }],
  quietPeriodMs: MINUTE,
};

describe('alertMessageOf', () => {
  it('names the rule, the Issue and its title, with a delivery identity fixed by the firing', () => {
    const firing = alertFiring({ rule, issueId: 'issue-1', at: T0 });
    const message = alertMessageOf({ projectId: 'project-1', firing, title: 'TypeError: x is undefined' });
    expect(message).toEqual({
      deliveryId: `rule-1:issue-1:${T0}`,
      projectId: 'project-1',
      ruleId: 'rule-1',
      issueId: 'issue-1',
      subject: 'Alert: TypeError: x is undefined',
      text: 'Issue Alert Rule rule-1 fired for issue issue-1: TypeError: x is undefined',
    });
    expect(alertMessageOf({ projectId: 'project-1', firing, title: 'other' }).deliveryId).toBe(message.deliveryId);
  });
});

describe('incidentMessageOf', () => {
  it('names the rule, the levels and the value, with no Issue', () => {
    const message = incidentMessageOf({
      projectId: 'project-1',
      change: { ruleId: 'metric-1', from: 'closed', to: 'critical', at: T0, value: 120, actor: 'system' },
    });
    expect(message).toEqual({
      deliveryId: `metric-1:incident:${T0}`,
      projectId: 'project-1',
      ruleId: 'metric-1',
      issueId: null,
      subject: 'Incident critical: metric-1',
      text: 'Metric Alert Rule metric-1 went from closed to critical at value 120.',
    });
  });
});

describe('digestMailOf', () => {
  it('lists every gathered Issue in one mail', () => {
    let digest = emptyDigest({ ruleId: 'rule-1', recipient: 'mia@acme.example' });
    digest = gather(digest, { issueId: 'issue-1', title: 'TypeError', at: T0 });
    digest = gather(digest, { issueId: 'issue-2', title: 'RangeError', at: T0 + 1 });
    digest = gather(digest, { issueId: 'issue-1', title: 'TypeError', at: T0 + 2 });
    expect(digestMailOf(digest)).toEqual({
      to: 'mia@acme.example',
      subject: '3 alerts from rule rule-1',
      text: 'TypeError (2 alerts)\nRangeError (1 alert)',
      headers: {},
    });
  });
});

describe('workflowMailOf', () => {
  it('says what changed on the Issue', () => {
    const change = {
      issueId: 'issue-1',
      kind: 'status',
      from: 'unresolved/new',
      to: 'resolved',
      actor: 'system',
      origin: 'nightwatch',
      at: T0,
    } as const;
    expect(workflowMailOf({ issueId: 'issue-1', member: 'member-mia', change })).toEqual({
      subject: 'Issue issue-1: status changed',
      text: 'Issue issue-1: status changed from unresolved/new to resolved.',
    });
    expect(
      workflowMailOf({ issueId: 'issue-1', member: 'member-mia', change: { ...change, kind: 'comment', from: null, to: 'c-1' } }).subject,
    ).toBe('Issue issue-1: new comment');
  });
});

describe('frequencyWindows', () => {
  it('takes the widest window of each kind of frequency trigger, null when the rule has none', () => {
    expect(frequencyWindows(rule)).toEqual({ events: null, users: null });
    const counting: IssueAlertRule = {
      ...rule,
      triggers: [
        { kind: 'event_frequency', count: 5, windowMs: MINUTE },
        { kind: 'event_frequency', count: 50, windowMs: 60 * MINUTE },
        { kind: 'user_frequency', count: 2, windowMs: 10 * MINUTE },
      ],
    };
    expect(frequencyWindows(counting)).toEqual({ events: 60 * MINUTE, users: 10 * MINUTE });
  });
});

describe('issueKindOf', () => {
  it('is a Report issue while it holds no Fingerprint', () => {
    expect(issueKindOf(0)).toBe('report');
    fc.assert(fc.property(fc.integer({ min: 1 }), (count) => issueKindOf(count) === 'crash'));
  });
});

describe('latestReleaseOf', () => {
  it('is the newest Release seen, null when none was', () => {
    expect(latestReleaseOf(new Map())).toBeNull();
    expect(
      latestReleaseOf(
        new Map([
          ['1.10.0', T0],
          ['1.9.0', T0 + 1],
        ]),
      ),
    ).toBe('1.10.0');
  });
});
