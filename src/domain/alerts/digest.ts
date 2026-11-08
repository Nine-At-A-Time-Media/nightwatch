/**
 * Digest -- the alert emails gathered for one recipient and one Issue Alert
 * Rule, sent as one (design Alerts and notifications, Digest; Domain
 * Language: Digest, Digest Minimum Delay, Digest Maximum Delay).
 *
 * DigestPolicy times a Digest: each item pushes the due time to the last
 * item plus the increment, never sooner than the Digest Minimum Delay and
 * never later than the Digest Maximum Delay after the first item. The
 * summary has one line per Issue, in the order the Issues first arrived.
 * Times and delays are epoch milliseconds.
 */

import type { IssueId } from '../ids.js';
import { refusal, type Refusal } from '../refusal.js';

export type DigestPolicy = {
  readonly minimumDelayMs: number;
  readonly incrementMs: number;
  readonly maximumDelayMs: number;
};

/** One gathered alert email. */
export type DigestItem = { readonly issueId: IssueId; readonly title: string; readonly at: number };

export type Digest = {
  readonly ruleId: string;
  /** The recipient's address. */
  readonly recipient: string;
  readonly items: readonly DigestItem[];
};

// --- predicates ---

function isValidPolicy(policy: DigestPolicy): boolean {
  return policy.minimumDelayMs >= 0 && policy.incrementMs >= 0 && policy.minimumDelayMs < policy.maximumDelayMs;
}

// --- helpers ---

function alertCount(n: number): string {
  return n === 1 ? '1 alert' : `${n} alerts`;
}

// --- exports ---

/** A DigestPolicy, or a Refusal when a delay is negative or the minimum is not below the maximum. */
export function digestPolicy(policy: DigestPolicy): DigestPolicy | Refusal {
  return isValidPolicy(policy) ? policy : refusal('digest_policy_invalid');
}

/** When a Digest with these first and last items is due. */
export function dueAt({ firstItemAt, lastItemAt, policy }: { firstItemAt: number; lastItemAt: number; policy: DigestPolicy }): number {
  const earliest = firstItemAt + policy.minimumDelayMs;
  const latest = firstItemAt + policy.maximumDelayMs;
  return Math.min(Math.max(lastItemAt + policy.incrementMs, earliest), latest);
}

export function emptyDigest({ ruleId, recipient }: { ruleId: string; recipient: string }): Digest {
  return { ruleId, recipient, items: [] };
}

export function gather(digest: Digest, item: DigestItem): Digest {
  return { ...digest, items: [...digest.items, item] };
}

/** When the Digest is due; null while it holds nothing. */
export function digestDueAt(digest: Digest, policy: DigestPolicy): number | null {
  const [first, ...rest] = digest.items;
  if (first === undefined) return null;
  const firstItemAt = rest.reduce((earliest, item) => Math.min(earliest, item.at), first.at);
  const lastItemAt = rest.reduce((latest, item) => Math.max(latest, item.at), first.at);
  return dueAt({ firstItemAt, lastItemAt, policy });
}

export function isDigestDue(digest: Digest, policy: DigestPolicy, now: number): boolean {
  const due = digestDueAt(digest, policy);
  return due !== null && now >= due;
}

/** One line per Issue: its title and how many alerts it gathered. */
export function digestSummaryLines(digest: Digest): readonly string[] {
  const byIssue = new Map<IssueId, { title: string; count: number }>();
  for (const item of digest.items) {
    const seen = byIssue.get(item.issueId);
    byIssue.set(item.issueId, { title: seen?.title ?? item.title, count: (seen?.count ?? 0) + 1 });
  }
  return [...byIssue.values()].map(({ title, count }) => `${title} (${alertCount(count)})`);
}
