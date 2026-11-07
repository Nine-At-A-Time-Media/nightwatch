/**
 * Reporter Notification -- a message to a Reporter about their Report
 * (design Reports, Notification and Spam; State Machine: Report Status).
 * One is due on each change of the Report Status shown, and on each shared
 * Member Comment; never for a spam Report or an unsubscribed Reporter. A
 * reporter's own reply notifies no reporter. What the message says, and the
 * Follow-up Page link it carries, are composed where it is sent.
 */

import type { Report } from './report.js';
import type { ReportStatus } from './status.js';
import type { Comment } from './thread.js';

export type ReporterNotification = {
  readonly reportId: string;
  /** The Reporter's address. */
  readonly to: string;
  /** The new Report Status, or the id of the shared Comment. */
  readonly about: { readonly status: ReportStatus } | { readonly comment: string };
};

// --- predicates ---

function isSilenced(report: Report): boolean {
  return report.spam || report.unsubscribed;
}

// --- helpers ---

function notification(report: Report, about: ReporterNotification['about']): ReporterNotification {
  return { reportId: report.id, to: report.reporter.email, about };
}

// --- exports ---

/** The notice for a change of the shown Report Status, or null when none is due. */
export function reporterNotificationFor(before: ReportStatus, after: ReportStatus, report: Report): ReporterNotification | null {
  if (before === after || isSilenced(report)) return null;
  return notification(report, { status: after });
}

/** The notice for a Comment saved on the Report's Issue, or null when none is due. */
export function reporterNotificationForComment(comment: Comment, report: Report): ReporterNotification | null {
  if (!('member' in comment.author) || !comment.shared || isSilenced(report)) return null;
  return notification(report, { comment: comment.id });
}
