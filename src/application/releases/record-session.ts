/**
 * recordSession -- the ProjectDO step that counts one Session (design
 * Releases and monitors, Release health; architecture Mechanism: Sessions
 * update per-minute counters in ProjectDO). No design row of its own:
 * processing reaches it through ProjectClient once per Session. In one
 * IssueStore transaction it adds the Session to its minute's counter and,
 * when the Session names a user, records that user, crashed or not.
 * Ports: IssueStore.
 */

import { isCrash, sessionBucket, type Session } from '../../domain/release/health.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type RecordSessionDeps = { issues: IssueStore };

// --- flow ---

async function countInTransaction(session: Session, issues: IssueStore): Promise<void> {
  await issues.addSessions(sessionBucket(session), 1);
  if (session.userKey === null) return;
  const crashed = isCrash(session.status);
  await issues.markSessionUser({ release: session.release, environment: session.environment, userKey: session.userKey, crashed });
}

// --- exports ---

export async function recordSession(session: Session, deps: RecordSessionDeps): Promise<void> {
  await deps.issues.transact(() => countInTransaction(session, deps.issues));
}
