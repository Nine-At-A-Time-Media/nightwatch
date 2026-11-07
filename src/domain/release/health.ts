/**
 * Release Health -- crash-free session and user rates per Release and
 * Environment (design Releases and monitors, Release health; Domain
 * Language: Session, Environment; architecture Mechanism, Releases, health
 * and monitors: per-minute counters in ProjectDO).
 *
 * A Session is counted once, in the whole minute it started, under its
 * release, environment and how it ended. A crashed or abnormal Session is a
 * crash; the crash-free session rate is the share of Sessions that were not.
 * A user is crash-free while none of their Sessions crashed; the crash-free
 * user rate is the share of users who are. A Session with no user counts
 * toward the session rate only. With nothing to rate, a rate is null.
 */

import type { Release } from './ordering.js';

/** A named place a product runs, such as production. */
export type Environment = string;

export const SESSION_STATUSES = ['ok', 'exited', 'errored', 'crashed', 'abnormal'] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** One use of a product, as reported by an SDK, with how it ended. `userKey` is null when the SDK named no user. */
export type Session = {
  readonly release: Release;
  readonly environment: Environment;
  readonly status: SessionStatus;
  readonly userKey: string | null;
  readonly startedAt: number;
};

/** The counter one Session adds to: a release, environment, status and whole minute (epoch ms). */
export type SessionBucket = {
  readonly release: Release;
  readonly environment: Environment;
  readonly status: SessionStatus;
  readonly minute: number;
};

export type SessionCounts = Readonly<Record<SessionStatus, number>>;

export type UserCounts = { readonly users: number; readonly crashedUsers: number };

export type ReleaseHealth = {
  readonly release: Release;
  readonly environment: Environment;
  readonly sessions: number;
  readonly crashFreeSessionRate: number | null;
  readonly users: number;
  readonly crashFreeUserRate: number | null;
};

export const NO_SESSIONS: SessionCounts = { ok: 0, exited: 0, errored: 0, crashed: 0, abnormal: 0 };

const MINUTE = 60_000;

// --- predicates ---

export function isCrash(status: SessionStatus): boolean {
  return status === 'crashed' || status === 'abnormal';
}

// --- helpers ---

function crashFreeRate(total: number, crashed: number): number | null {
  return total === 0 ? null : (total - crashed) / total;
}

// --- exports ---

export function sessionBucket(session: Session): SessionBucket {
  return {
    release: session.release,
    environment: session.environment,
    status: session.status,
    minute: Math.floor(session.startedAt / MINUTE) * MINUTE,
  };
}

export function releaseHealthOf(totals: {
  release: Release;
  environment: Environment;
  sessions: SessionCounts;
  users: UserCounts;
}): ReleaseHealth {
  const sessions = SESSION_STATUSES.reduce((sum, status) => sum + totals.sessions[status], 0);
  const crashed = SESSION_STATUSES.filter(isCrash).reduce((sum, status) => sum + totals.sessions[status], 0);
  return {
    release: totals.release,
    environment: totals.environment,
    sessions,
    crashFreeSessionRate: crashFreeRate(sessions, crashed),
    users: totals.users.users,
    crashFreeUserRate: crashFreeRate(totals.users.users, totals.users.crashedUsers),
  };
}
