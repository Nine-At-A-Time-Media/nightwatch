/**
 * Monitor issue -- the Issue a failing monitor opens and its recovery
 * resolves (design Releases and monitors, Monitor issues; State Machine:
 * Cron and Uptime Monitor, Failing to Incident and Recovering to OK). Like a
 * Report issue it holds no Fingerprint and counts no Event: it opens
 * Unresolved/New in For Review. Recovery resolves it plainly, as the
 * system; if a Member already moved it out of Unresolved, recovery leaves
 * it where they put it.
 */

import { resolve } from '../issue/commands.js';
import { chain, change, enterForReview, unchanged, type IssueState, type IssueTransition } from '../issue/state.js';
import type { IssueId } from '../ids.js';
import { isRefusal } from '../refusal.js';

const MONITOR_ISSUE_PRIORITY = { level: 'medium', setByHand: false } as const;

// --- exports ---

export function createMonitorIssue(opening: { issueId: IssueId; at: number }): IssueTransition {
  const state: IssueState = {
    issueId: opening.issueId,
    substatusSince: opening.at,
    firstSeen: opening.at,
    lastSeen: opening.at,
    count: 0,
    userCount: 0,
    priority: MONITOR_ISSUE_PRIORITY,
    forReviewSince: null,
    status: 'unresolved',
    substatus: 'new',
  };
  const opened = { state, changes: [change(state, { kind: 'status', from: null, to: 'unresolved/new', actor: 'system', at: opening.at })] };
  return chain(opened, (s) => enterForReview(s, opening.at));
}

export function resolveMonitorIssue(state: IssueState, at: number): IssueTransition {
  const resolved = resolve(state, { kind: 'plain' }, 'system', at);
  return isRefusal(resolved) ? unchanged(state) : resolved;
}
