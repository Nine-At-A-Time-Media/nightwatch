/**
 * The github Worker's webhook step: a webhook already proven to come from
 * GitHub is mapped to Tracker Events and Commits (the github adapter's
 * webhook-events) and each is applied through its use case, applyTrackerEvent
 * or applyCommits (architecture Mechanism, Code and GitHub). The Issue
 * Changes they make are enqueued by the Projects that make them.
 */

import { applyCommits } from '../../application/tracker/apply-commits.js';
import { applyTrackerEvent } from '../../application/tracker/apply-tracker-event.js';
import { commitsOf, trackerEventsOf } from '../../adapters/github/webhook-events.js';
import type { GitHubRuntime } from './deps.js';

/** What one verified webhook came to: how many Tracker Events and Commits it carried. */
export type WebhookApplied = { readonly trackerEvents: number; readonly commits: number };

// --- flow ---

export async function applyWebhook(webhook: { eventName: string; payload: unknown }, runtime: GitHubRuntime): Promise<WebhookApplied> {
  const events = trackerEventsOf(webhook.eventName, webhook.payload);
  for (const event of events) await applyTrackerEvent(event, runtime.trackerEvents);
  const commits = commitsOf(webhook.eventName, webhook.payload);
  if (commits.length > 0) await applyCommits(commits, runtime.commits);
  return { trackerEvents: events.length, commits: commits.length };
}
