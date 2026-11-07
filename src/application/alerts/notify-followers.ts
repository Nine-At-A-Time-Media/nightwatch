/**
 * notifyFollowers -- the notifier's Workflow Notifications for one Issue
 * Change (design Behaviors: Settings respected; Alerts and notifications,
 * Subscriptions, Settings, Threading and Reply by email).
 *
 * The followers are the Members who commented on, were assigned or were
 * mentioned in the Issue. Every Member of the Project whose workflow setting
 * admits the change -- always, or followed-only when they follow it, with
 * the Project setting winning over the Organization one -- is emailed. Each
 * email threads under the Issue's key and carries a Reply-To address whose
 * signed Reply Token names the Issue and the recipient Member, so a reply
 * can become their comment (applyEmailReply). Ports: ControlStore,
 * ProjectClient, Mailer, Signer, Clock.
 */

import { workflowMailOf } from '../../domain/alerts/alert-message.js';
import {
  followersOf,
  workflowNotifications,
  type NotificationSettings,
  type WorkflowNotification,
} from '../../domain/alerts/notification-settings.js';
import type { ProjectId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { replyAddress, replyTokenText, threadHeaders, type ReplyToken } from '../../domain/mail/reply-address.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { Mailer } from '../../ports/mailer.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { Signer } from '../../ports/signer.js';

/**
 * Notifier settings for issue emails.
 * - mailDomain: the domain of the per-Issue thread key.
 * - replyDomain: the domain Email Routing delivers replies from.
 * - replyLifetimeMs: how long a Reply-To address is accepted (Reply-by-email address lifetime).
 */
export type IssueMailSettings = { readonly mailDomain: string; readonly replyDomain: string; readonly replyLifetimeMs: number };

export type NotifyFollowersDeps = {
  control: ControlStore;
  projects: ProjectClient;
  mailer: Mailer;
  signer: Signer;
  clock: Clock;
  settings: IssueMailSettings;
};

type MemberSettings = { readonly member: string; readonly settings: NotificationSettings };

// --- flow: who is due ---

async function memberSettingsOf(projectId: ProjectId, control: ControlStore): Promise<MemberSettings[]> {
  const members: MemberSettings[] = [];
  for (const member of await control.projectMembers(projectId)) {
    members.push({ member: member.member, settings: await control.notificationSettingsOf(member) });
  }
  return members;
}

// --- flow: one email ---

async function replyToOf(token: ReplyToken, deps: NotifyFollowersDeps): Promise<string> {
  const text = replyTokenText(token);
  const signature = await deps.signer.sign(text);
  return replyAddress({ text, signature, domain: deps.settings.replyDomain });
}

async function send(projectId: ProjectId, notification: WorkflowNotification, deps: NotifyFollowersDeps): Promise<boolean> {
  const to = await deps.control.addressOf({ member: notification.member });
  if (to === null) return false;
  const { issueId, member } = notification;
  const replyTo = await replyToOf({ projectId, issueId, member, expiresAt: deps.clock.now() + deps.settings.replyLifetimeMs }, deps);
  const headers = { ...threadHeaders({ projectId, issueId, domain: deps.settings.mailDomain }), 'Reply-To': replyTo };
  const sent = await deps.mailer.send({ to, ...workflowMailOf(notification), headers });
  return sent.ok;
}

// --- exports ---

export async function notifyFollowers(project: ProjectId, change: IssueChange, deps: NotifyFollowersDeps): Promise<WorkflowNotification[]> {
  const followers = followersOf(await deps.projects.participationsOf(project, change.issueId));
  const members = await memberSettingsOf(project, deps.control);
  const sent: WorkflowNotification[] = [];
  for (const notification of workflowNotifications({ change, projectId: project, followers, members })) {
    if (await send(project, notification, deps)) sent.push(notification);
  }
  return sent;
}
