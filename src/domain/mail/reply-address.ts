/**
 * Reply address and threading -- how an issue notification email names the
 * Issue and recipient Member a reply is for, and how every email about one
 * Issue threads together (design Alerts and notifications, Reply by email
 * and Threading; architecture Mechanism, Alerts and notifications).
 *
 * A Reply Token names the Project, the Issue, the recipient Member and when
 * the address stops being accepted. Its text is the base64url of those
 * fields; the Signer signs that text, and the Reply-To address carries both:
 * `reply+<text>.<signature>@<domain>`. Nothing here verifies a signature.
 * Times are epoch milliseconds.
 */

import type { IssueId, ProjectId } from '../ids.js';

export type ReplyToken = {
  readonly projectId: ProjectId;
  readonly issueId: IssueId;
  /** The recipient Member's id. */
  readonly member: string;
  readonly expiresAt: number;
};

/**
 * A reply to an issue notification email, as the inbound-mail Worker hands
 * it over once the email adapter has parsed it and authenticated its sender.
 */
export type InboundReply = { readonly to: string; readonly from: string; readonly text: string };

/** A Reply Token's text and its signature, as read from an address. */
export type SignedReplyToken = { readonly text: string; readonly signature: string };

const SEPARATOR = '\u0000';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REPLY_ADDRESS = /^reply\+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)@[^@\s<>]+$/;
const BRACKETED = /<([^<>]+)>/;
const DIGITS = /^\d+$/;

// --- helpers ---

function toBase64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64url(text: string): string | null {
  if (!BASE64URL.test(text)) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function bareAddress(address: string): string {
  return (BRACKETED.exec(address)?.[1] ?? address).trim();
}

function tokenOfFields(fields: readonly string[]): ReplyToken | null {
  const [projectId, issueId, member, expiresAt] = fields;
  if (fields.length !== 4 || !projectId || !issueId || !member || expiresAt === undefined || !DIGITS.test(expiresAt)) return null;
  return { projectId, issueId, member, expiresAt: Number(expiresAt) };
}

// --- exports ---

/** The text the Signer signs and the address carries. */
export function replyTokenText(token: ReplyToken): string {
  return toBase64url([token.projectId, token.issueId, token.member, String(token.expiresAt)].join(SEPARATOR));
}

/** The Reply Token a token text names, or null when it is malformed. */
export function replyTokenOf(text: string): ReplyToken | null {
  const decoded = fromBase64url(text);
  return decoded === null ? null : tokenOfFields(decoded.split(SEPARATOR));
}

export function replyAddress({ text, signature, domain }: { text: string; signature: string; domain: string }): string {
  return `reply+${text}.${signature}@${domain}`;
}

/** The token text and signature a reply was addressed to, or null when it is not a reply address. */
export function parseReplyAddress(address: string): SignedReplyToken | null {
  const match = REPLY_ADDRESS.exec(bareAddress(address));
  const [, text, signature] = match ?? [];
  return text && signature ? { text, signature } : null;
}

/** Whether a sender (`Name <address>` or a bare address) is this address, without regard to case. */
export function isFromAddress({ from, address }: { from: string; address: string }): boolean {
  return bareAddress(from).toLowerCase() === address.trim().toLowerCase();
}

export function isReplyTokenLive(token: ReplyToken, now: number): boolean {
  return now < token.expiresAt;
}

/** The headers that thread every email about one Issue under one key. */
export function threadHeaders({
  projectId,
  issueId,
  domain,
}: {
  projectId: ProjectId;
  issueId: IssueId;
  domain: string;
}): Readonly<Record<string, string>> {
  const key = `<issue.${projectId}.${issueId}@${domain}>`;
  return { 'In-Reply-To': key, References: key };
}
