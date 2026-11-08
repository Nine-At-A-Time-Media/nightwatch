/**
 * Outbound -- what Nightwatch sends to GitHub (design Code and GitHub,
 * Two-way state; Security: reporter addresses reaching a public GitHub
 * repository).
 *
 * An Issue Change maps to a close, a reopen, or nothing. A change that came
 * from the tracker maps to nothing, so it is never echoed back. Only a close
 * GitHub saw (resolved, archived forever) is ever undone by a reopen.
 *
 * An outbound issue body is built from a closed set of Issue facts. There is
 * no field for a reporter address or an Attachment, so neither can reach
 * GitHub through it; the template reads only the fields it names, so extra
 * fields on the value passed in are ignored. Event text is set in code spans
 * on one line, so it can neither add Markdown nor mention anyone.
 *
 * A reporter's reply is posted as a quote of what they wrote (design Code and
 * GitHub, Comments). The template takes the Reporter's address only to remove
 * it: wherever the reply repeats it, in any case, it is replaced. Every `@` is
 * written as an entity, so the reply mentions no one, and `<` likewise, so it
 * carries no HTML.
 */

import type { IssueChange } from '../issue/state.js';
import type { CloseReason, TrackerState } from './external-link.js';

export type OutboundChange =
  { readonly kind: 'close'; readonly reason: CloseReason } | { readonly kind: 'reopen' } | { readonly kind: 'none' };

/** The Issue facts an outbound issue body may carry; times are epoch milliseconds. */
export type OutboundIssueFacts = {
  readonly title: string;
  readonly culprit: string;
  /** The console link to the Issue; it opens only behind Access. */
  readonly evidenceUrl: string;
  readonly counts: { readonly events: number; readonly users: number };
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly reportCount: number;
};

const NONE: OutboundChange = { kind: 'none' };
const CLOSED_LABELS = ['resolved', 'archived/forever'];
const UNRESOLVED_PREFIX = 'unresolved/';
const BACKTICK_RUN = /`+/g;
const LINE_BREAK = /\r\n|\r|\n/g;
const URL_MARKUP = /[<>\s]/g;
const REPLY_HEADING = '**Reporter reply**';
const ADDRESS_REMOVED = '[address removed]';
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

// --- sub-component: outbound change ---

function isClosedOnTracker(label: string | null): boolean {
  return label !== null && CLOSED_LABELS.includes(label);
}

function isUnresolved(label: string | null): boolean {
  return label !== null && label.startsWith(UNRESOLVED_PREFIX);
}

export function outboundChangeFor(change: IssueChange): OutboundChange {
  if (change.origin === 'tracker' || change.kind !== 'status') return NONE;
  if (change.to === 'resolved') return { kind: 'close', reason: 'completed' };
  if (change.to === 'archived/forever') return { kind: 'close', reason: 'not_planned' };
  if (isClosedOnTracker(change.from) && isUnresolved(change.to)) return { kind: 'reopen' };
  return NONE;
}

/** The GitHub state an outbound change leaves behind, which the External Link then expects; null for none. */
export function expectedStateAfter(change: OutboundChange): TrackerState | null {
  if (change.kind === 'close') return { state: 'closed', reason: change.reason };
  if (change.kind === 'reopen') return { state: 'open' };
  return null;
}

// --- sub-component: outbound issue body ---

function longestBacktickRun(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(BACKTICK_RUN), (match) => match[0].length));
}

/** Event text as one inline code span, whatever backticks or line breaks it holds. */
function codeSpan(text: string): string {
  const line = text.replace(LINE_BREAK, ' ');
  if (line.trim() === '') return '(none)';
  const fence = '`'.repeat(longestBacktickRun(line) + 1);
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

/** A table cell; a pipe would end the cell early, even inside a code span. */
function tableCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

function linkTarget(url: string): string {
  return url.replace(URL_MARKUP, (character) => encodeURIComponent(character));
}

function isoTime(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function outboundIssueBody(facts: OutboundIssueFacts): string {
  return [
    codeSpan(facts.title),
    '',
    '| Fact | Value |',
    '|---|---|',
    `| Culprit | ${tableCell(codeSpan(facts.culprit))} |`,
    `| Events | ${facts.counts.events} |`,
    `| Users | ${facts.counts.users} |`,
    `| Reports | ${facts.reportCount} |`,
    `| First seen | ${isoTime(facts.firstSeen)} |`,
    `| Last seen | ${isoTime(facts.lastSeen)} |`,
    '',
    `[Evidence in Nightwatch](<${linkTarget(facts.evidenceUrl)}>)`,
    '',
  ].join('\n');
}

// --- sub-component: outbound reply body ---

function withoutAddress(text: string, address: string): string {
  if (address === '') return text;
  return text.replace(new RegExp(address.replace(REGEX_SPECIAL, '\\$&'), 'gi'), ADDRESS_REMOVED);
}

function inert(line: string): string {
  return line.replaceAll('&', '&amp;').replaceAll('@', '&#64;').replaceAll('<', '&lt;');
}

/** The body of a reporter's reply as posted to the linked tracker issue: a quote, with no address and no mention. */
export function outboundReplyBody(reply: { readonly text: string; readonly reporterAddress: string }): string {
  const lines = withoutAddress(reply.text, reply.reporterAddress).split(LINE_BREAK).map(inert);
  return [REPLY_HEADING, '', ...lines.map((line) => `> ${line}`), ''].join('\n');
}
