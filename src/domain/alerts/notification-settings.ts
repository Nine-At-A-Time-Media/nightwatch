/**
 * Notification settings and Subscriptions (design Alerts and notifications,
 * Subscriptions and Settings; Domain Language: Workflow Notification).
 *
 * A Member sets each notification kind to always, never or followed-only,
 * per Organization and per Project; the Project setting wins over the
 * Organization one, which wins over the kind's default. Members follow the
 * Issues they commented on, were assigned, or were mentioned in. A Workflow
 * Notification goes to every Member whose setting admits it: always, or
 * followed-only when they follow the Issue.
 */

import type { IssueId, ProjectId } from '../ids.js';
import type { IssueChange } from '../issue/state.js';

export type NotificationKind = 'workflow' | 'issue_alert' | 'metric_alert';

export type NotificationSetting = 'always' | 'never' | 'followed_only';

type SettingsByKind = Readonly<Partial<Record<NotificationKind, NotificationSetting>>>;

/** One Member's settings: Organization-wide, and per Project by Project Id. */
export type NotificationSettings = {
  readonly organization: SettingsByKind;
  readonly projects: Readonly<Record<ProjectId, SettingsByKind>>;
};

export type FollowReason = 'commented' | 'assigned' | 'mentioned';

/** One reason a Member follows an Issue. */
export type Participation = { readonly member: string; readonly reason: FollowReason };

export type Follower = { readonly member: string; readonly reasons: readonly FollowReason[] };

export type WorkflowNotification = { readonly issueId: IssueId; readonly member: string; readonly change: IssueChange };

const DEFAULT_SETTING: Readonly<Record<NotificationKind, NotificationSetting>> = {
  workflow: 'followed_only',
  issue_alert: 'always',
  metric_alert: 'always',
};

// --- predicates ---

/** Whether a Member with this setting receives a notification about an Issue they do or do not follow. */
export function isNotified(setting: NotificationSetting, following: boolean): boolean {
  return setting === 'always' || (setting === 'followed_only' && following);
}

// --- exports ---

/** The setting in force for one kind in one Project: Project, then Organization, then the default. */
export function notificationSettingOf({
  settings,
  kind,
  projectId,
}: {
  settings: NotificationSettings;
  kind: NotificationKind;
  projectId: ProjectId;
}): NotificationSetting {
  return settings.projects[projectId]?.[kind] ?? settings.organization[kind] ?? DEFAULT_SETTING[kind];
}

/** The followers of an Issue, one per Member, with each distinct reason in the order first given. */
export function followersOf(participations: readonly Participation[]): readonly Follower[] {
  const reasons = new Map<string, readonly FollowReason[]>();
  for (const { member, reason } of participations) {
    const known = reasons.get(member) ?? [];
    reasons.set(member, known.includes(reason) ? known : [...known, reason]);
  }
  return [...reasons].map(([member, memberReasons]) => ({ member, reasons: memberReasons }));
}

/** The Workflow Notifications due for a change, to the Members whose settings admit it, in Member order. */
export function workflowNotifications({
  change,
  projectId,
  followers,
  members,
}: {
  change: IssueChange;
  projectId: ProjectId;
  followers: readonly Follower[];
  /** Every Member who may receive it, with their settings. */
  members: readonly { readonly member: string; readonly settings: NotificationSettings }[];
}): readonly WorkflowNotification[] {
  const following = new Set(followers.map((follower) => follower.member));
  return members
    .filter(({ member, settings }) => isNotified(notificationSettingOf({ settings, kind: 'workflow', projectId }), following.has(member)))
    .map(({ member }) => ({ issueId: change.issueId, member, change }));
}
