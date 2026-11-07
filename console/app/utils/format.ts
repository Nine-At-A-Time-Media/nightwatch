/**
 * How the console's pages print values: Report Statuses in words, and
 * instants as UTC minutes, so every viewer reads the same date.
 */

import type { ReportStatus } from '#nightwatch/domain/report/status.js';

const STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  received: 'Received',
  acknowledged: 'Acknowledged',
  fixed: 'Fixed',
  released: 'Released',
  closed: 'Closed',
};

// --- exports ---

export function statusLabel(status: ReportStatus): string {
  return STATUS_LABELS[status];
}

/** An instant (epoch milliseconds) as `YYYY-MM-DD HH:MM UTC`. */
export function utcMinute(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function isoInstant(at: number): string {
  return new Date(at).toISOString();
}

/** The Follow-up Page path of a Report Reference. */
export function followUpPath(reference: string): string {
  return `/follow-up/${encodeURIComponent(reference)}`;
}
