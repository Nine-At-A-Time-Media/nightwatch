/**
 * Notices -- what a Reporter Notification says (design Reports, Reference
 * and Notification). Each carries the Follow-up Page link; the filing
 * receipt also carries the Report Reference. A notice names the Report
 * Status or quotes the shared Comment, and says nothing else about the Issue.
 */

import type { ReportReference } from './reference.js';
import type { ReportStatus } from './status.js';

export type Notice = { readonly subject: string; readonly text: string };

const STATUS_WORDS: Readonly<Record<ReportStatus, string>> = {
  received: 'received',
  acknowledged: 'acknowledged by the team',
  fixed: 'fixed',
  released: 'fixed, and the fix has been released',
  closed: 'closed',
};

// --- helpers ---

function footer(link: string): string {
  return `Follow your report here: ${link}`;
}

// --- exports ---

export function receiptNotice(entry: { reference: ReportReference; link: string }): Notice {
  return {
    subject: 'Your report was received',
    text: `Thank you for your report. Its reference is ${entry.reference}.\n\n${footer(entry.link)}`,
  };
}

export function statusNotice(entry: { status: ReportStatus; link: string }): Notice {
  const words = STATUS_WORDS[entry.status];
  return { subject: `Your report is ${words}`, text: `Your report is now ${words}.\n\n${footer(entry.link)}` };
}

export function commentNotice(entry: { text: string; link: string }): Notice {
  return { subject: 'The team replied to your report', text: `The team wrote:\n\n${entry.text}\n\n${footer(entry.link)}` };
}
