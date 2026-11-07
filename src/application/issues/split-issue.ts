/**
 * splitIssue -- a Member splits chosen Fingerprints off an Issue into a new
 * one (design Behaviors: Split; Issues, Split). In one IssueStore
 * transaction the chosen Fingerprints, and every Event grouped by any of
 * them, move to a new Issue with its own Short Id; both Issues are
 * recounted. Because the Fingerprints move inside the transaction, an Event
 * that arrives during the split lands in the new Issue. Ports: IssueStore,
 * Ids, Clock.
 */

import type { Fingerprint } from '../../domain/grouping/fingerprint.js';
import type { IssueId } from '../../domain/ids.js';
import { splitOff, splitRefusal } from '../../domain/issue/regroup.js';
import { goneRefusal, issueNotFound, type IssueChange, type Member } from '../../domain/issue/state.js';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { Clock } from '../../ports/clock.js';
import type { Ids } from '../../ports/ids.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type SplitIssueDeps = { issues: IssueStore; ids: Ids; clock: Clock };

type Split = { issue: IssueId; fingerprints: readonly Fingerprint[]; actor: Member; at: number };

// --- flow ---

async function summariesOf(issueId: IssueId, issues: IssueStore) {
  return (await issues.eventsOf(issueId)).map((event) => event.summary);
}

async function splitInTransaction(split: Split, deps: SplitIssueDeps): Promise<IssueChange[] | Refusal> {
  const { issues } = deps;
  const from = await issues.getIssue(split.issue);
  if (from === null) return issueNotFound();
  const gone = goneRefusal(from);
  if (gone) return gone;
  const refused = splitRefusal({ held: await issues.fingerprintsOf(split.issue), chosen: split.fingerprints });
  if (refused) return refused;
  const issueId = deps.ids.newId();
  await issues.moveFingerprints({ from: split.issue, to: issueId, fingerprints: split.fingerprints });
  const result = splitOff({
    from,
    issueId,
    remaining: await summariesOf(split.issue, issues),
    moved: await summariesOf(issueId, issues),
    actor: split.actor,
    at: split.at,
  });
  if (isRefusal(result)) return result;
  const changes = [...result.from.changes, ...result.split.changes];
  await issues.assignShortId(issueId);
  await issues.putIssue(result.from.state);
  await issues.putIssue(result.split.state);
  await issues.appendHistory(changes);
  return changes;
}

// --- exports ---

export async function splitIssue(
  issue: IssueId,
  fingerprints: Fingerprint[],
  actor: Member,
  deps: SplitIssueDeps,
): Promise<IssueChange[] | Refusal> {
  const split = { issue, fingerprints, actor, at: deps.clock.now() };
  return deps.issues.transact(() => splitInTransaction(split, deps));
}
