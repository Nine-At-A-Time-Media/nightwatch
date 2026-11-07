// Shared builders for the alerts use-case tests: one Organization with one
// Project, two Members (Mia, an owner in the backend Team, and Bob), a
// fresh set of fakes per test, and a way to send an Event through
// assignEvent and get the Alert Signals the notifier would evaluate.
import type { AlertSignal } from '../../../../src/application/alerts/evaluate-issue-alerts.js';
import type { DigestPolicy } from '../../../../src/domain/alerts/digest.js';
import type { AlertEvent, IssueAlertRule } from '../../../../src/domain/alerts/issue-alert-rule.js';
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import { FakeChannel } from '../../../_fakes/fake-channel.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeDigestQueue } from '../../../_fakes/fake-digest-queue.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeIncidentStore } from '../../../_fakes/fake-incident-store.js';
import { FakeMailer } from '../../../_fakes/fake-mailer.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { FakeSigner } from '../../../_fakes/fake-signer.js';
import { DAY, HOUR, MINUTE, T0, policies } from '../../domain/issue/fixtures.js';

export { DAY, HOUR, MINUTE, T0 };

export const ORG = 'org-1';
export const PROJECT = 'project-1';
export const MIA = { member: 'member-mia' } as const;
export const BOB = { member: 'member-bob' } as const;
export const MIA_EMAIL = 'mia@acme.example';
export const BOB_EMAIL = 'bob@acme.example';
export const EVE_EMAIL = 'eve@example.com';

export const DIGEST_POLICY: DigestPolicy = { minimumDelayMs: 5 * MINUTE, incrementMs: MINUTE, maximumDelayMs: 30 * MINUTE };
export const MAIL_SETTINGS = { mailDomain: 'mail.nightwatch.example', replyDomain: 'reply.nightwatch.example', replyLifetimeMs: 30 * DAY };
export const DELIVERY = { deliveryAttempts: 3 };

export function world() {
  const clock = new FakeClock(T0);
  const ids = new FakeIds('id');
  const effects = new FakeEffectQueue();
  const control = new FakeControlStore();
  control.addProject(ORG, PROJECT);
  control.addMember(PROJECT, MIA, { email: MIA_EMAIL, owner: true, teams: ['backend'] });
  control.addMember(PROJECT, BOB, { email: BOB_EMAIL });
  const projects = new FakeProjectClient({ clock, ids, effects, policies, dedupWindow: DAY });
  const email = new FakeChannel('email');
  const webhook = new FakeChannel('webhook');
  return {
    clock,
    ids,
    effects,
    control,
    projects,
    email,
    webhook,
    channels: [email, webhook],
    digestQueue: new FakeDigestQueue(DIGEST_POLICY),
    mailer: new FakeMailer(),
    signer: new FakeSigner('reply-secret'),
    incidents: new FakeIncidentStore(),
  };
}

export type World = ReturnType<typeof world>;

export function ruleOf(overrides: Partial<IssueAlertRule> = {}): IssueAlertRule {
  return {
    ruleId: 'rule-1',
    triggers: [{ kind: 'first_seen' }],
    actionMatch: 'any',
    filters: [],
    filterMatch: 'all',
    actions: [{ kind: 'webhook', url: 'https://hooks.example/nightwatch' }],
    quietPeriodMs: 30 * MINUTE,
    ...overrides,
  };
}

let eventCounter = 0;

export function alertEvent(at: number, overrides: Partial<AlertEvent> = {}): AlertEvent {
  eventCounter += 1;
  return {
    eventId: `event-${eventCounter}`,
    at,
    release: null,
    environment: 'production',
    level: 'error',
    userKey: `user-${eventCounter}`,
    title: 'TypeError: x is undefined',
    culprit: 'app/cart.ts',
    tags: {},
    attributes: {},
    ...overrides,
  };
}

function summaryOf(event: AlertEvent): EventSummary {
  const { eventId, at, release, environment, level, userKey, title, culprit } = event;
  return { eventId, at, release, environment, level, userKey, title, culprit };
}

/** Sends the Event through assignEvent at its time; returns the Alert Signals it raises: one per Issue Change, or one with no change. */
export async function arrive(w: World, event: AlertEvent, fingerprints: string[] = ['fp-a']): Promise<AlertSignal[]> {
  w.clock.set(event.at);
  const assignment = await w.projects.assignEvent(PROJECT, summaryOf(event), fingerprints);
  if (!('issueId' in assignment)) throw new Error('event dropped');
  if (assignment.changes.length === 0) return [{ issueId: assignment.issueId, change: null, event }];
  return assignment.changes.map((change) => ({ issueId: change.issueId, change, event }));
}
