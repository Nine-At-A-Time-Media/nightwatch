import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isCrash,
  NO_SESSIONS,
  releaseHealthOf,
  sessionBucket,
  SESSION_STATUSES,
  type Session,
  type SessionCounts,
} from '../../../../src/domain/release/health.js';

const T0 = Date.UTC(2026, 10, 1);

function counts(overrides: Partial<SessionCounts>): SessionCounts {
  return { ...NO_SESSIONS, ...overrides };
}

describe('isCrash', () => {
  it('counts a crashed or abnormal Session as a crash, and no other', () => {
    expect(SESSION_STATUSES.filter(isCrash)).toEqual(['crashed', 'abnormal']);
  });
});

describe('sessionBucket', () => {
  it('counts a Session in the whole minute it started, under its release, environment and status', () => {
    const session: Session = { release: 'web@1.0.0', environment: 'production', status: 'ok', userKey: 'ada', startedAt: T0 + 59_999 };
    expect(sessionBucket(session)).toEqual({ release: 'web@1.0.0', environment: 'production', status: 'ok', minute: T0 });
  });
});

describe('releaseHealthOf', () => {
  it('gives crash-free session and user rates', () => {
    const health = releaseHealthOf({
      release: 'web@1.0.0',
      environment: 'production',
      sessions: counts({ ok: 1, exited: 1, errored: 1, crashed: 1, abnormal: 1 }),
      users: { users: 3, crashedUsers: 2 },
    });
    expect(health).toEqual({
      release: 'web@1.0.0',
      environment: 'production',
      sessions: 5,
      crashFreeSessionRate: 0.6,
      users: 3,
      crashFreeUserRate: 1 / 3,
    });
  });

  it('gives no rate when there is nothing to rate', () => {
    const health = releaseHealthOf({ release: 'r', environment: 'e', sessions: NO_SESSIONS, users: { users: 0, crashedUsers: 0 } });
    expect(health).toMatchObject({ sessions: 0, crashFreeSessionRate: null, users: 0, crashFreeUserRate: null });
  });

  it('keeps each rate between zero and one', () => {
    const count = fc.nat({ max: 1000 });
    fc.assert(
      fc.property(count, count, count, count, count, count, count, (ok, exited, errored, crashed, abnormal, users, crashedUsers) => {
        const health = releaseHealthOf({
          release: 'r',
          environment: 'e',
          sessions: { ok, exited, errored, crashed, abnormal },
          users: { users: users + crashedUsers, crashedUsers },
        });
        const rates = [health.crashFreeSessionRate, health.crashFreeUserRate].filter((rate) => rate !== null);
        return rates.every((rate) => rate >= 0 && rate <= 1) && health.sessions === ok + exited + errored + crashed + abnormal;
      }),
    );
  });
});
