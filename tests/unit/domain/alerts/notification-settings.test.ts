import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  followersOf,
  isNotified,
  notificationSettingOf,
  workflowNotifications,
  type NotificationSetting,
  type NotificationSettings,
} from '../../../../src/domain/alerts/notification-settings.js';
import type { IssueChange } from '../../../../src/domain/issue/state.js';
import { T0 } from '../issue/fixtures.js';

const resolved: IssueChange = {
  issueId: 'issue-1',
  kind: 'status',
  from: 'unresolved/ongoing',
  to: 'resolved',
  actor: 'system',
  origin: 'nightwatch',
  at: T0,
};
const noSettings: NotificationSettings = { organization: {}, projects: {} };
const setting = fc.constantFrom<NotificationSetting>('always', 'never', 'followed_only');

describe('Notification settings', () => {
  it('Settings respected: Given a Member set workflow notifications to never for a Project, When an issue they follow there changes, Then they are not emailed', () => {
    const settings: NotificationSettings = { organization: { workflow: 'always' }, projects: { 'project-1': { workflow: 'never' } } };
    const notifications = workflowNotifications({
      change: resolved,
      projectId: 'project-1',
      followers: followersOf([{ member: 'm1', reason: 'commented' }]),
      members: [{ member: 'm1', settings }],
    });
    expect(notifications).toEqual([]);
  });

  it('notifies followers by default, and Members who chose always even when they do not follow', () => {
    const notifications = workflowNotifications({
      change: resolved,
      projectId: 'project-1',
      followers: followersOf([{ member: 'm1', reason: 'assigned' }]),
      members: [
        { member: 'm1', settings: noSettings },
        { member: 'm2', settings: noSettings },
        { member: 'm3', settings: { organization: { workflow: 'always' }, projects: {} } },
      ],
    });
    expect(notifications).toEqual([
      { issueId: 'issue-1', member: 'm1', change: resolved },
      { issueId: 'issue-1', member: 'm3', change: resolved },
    ]);
  });

  it('the Project setting wins over the Organization setting, which wins over the default', () => {
    fc.assert(
      fc.property(fc.option(setting, { nil: undefined }), fc.option(setting, { nil: undefined }), (organization, project) => {
        const settings: NotificationSettings = {
          organization: organization === undefined ? {} : { workflow: organization },
          projects: project === undefined ? {} : { 'project-1': { workflow: project } },
        };
        expect(notificationSettingOf({ settings, kind: 'workflow', projectId: 'project-1' })).toBe(
          project ?? organization ?? 'followed_only',
        );
        expect(notificationSettingOf({ settings, kind: 'workflow', projectId: 'project-2' })).toBe(organization ?? 'followed_only');
      }),
    );
  });

  it('alerts default to always', () => {
    expect(notificationSettingOf({ settings: noSettings, kind: 'issue_alert', projectId: 'project-1' })).toBe('always');
    expect(notificationSettingOf({ settings: noSettings, kind: 'metric_alert', projectId: 'project-1' })).toBe('always');
  });

  it('always notifies, never does not, and followed-only notifies followers', () => {
    expect(isNotified('always', false)).toBe(true);
    expect(isNotified('never', true)).toBe(false);
    expect(isNotified('followed_only', true)).toBe(true);
    expect(isNotified('followed_only', false)).toBe(false);
  });
});

describe('Subscriptions', () => {
  it('Members follow issues they commented on, were assigned, or were mentioned in, once each', () => {
    expect(
      followersOf([
        { member: 'm1', reason: 'commented' },
        { member: 'm2', reason: 'mentioned' },
        { member: 'm1', reason: 'assigned' },
        { member: 'm1', reason: 'commented' },
      ]),
    ).toEqual([
      { member: 'm1', reasons: ['commented', 'assigned'] },
      { member: 'm2', reasons: ['mentioned'] },
    ]);
  });
});
