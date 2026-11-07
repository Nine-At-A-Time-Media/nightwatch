import { describe, expect, it } from 'vitest';
import { evaluateIssueAlerts, type AlertSignal } from '../../../../src/application/alerts/evaluate-issue-alerts.js';
import { undeliveredActions, type AlertFiring } from '../../../../src/domain/alerts/alert-firing.js';
import { DELIVERY, HOUR, MIA, MIA_EMAIL, MINUTE, PROJECT, T0, alertEvent, arrive, ruleOf, world, type World } from './world.js';

/** The longest the tests allow between the satisfying Event and the firing. */
const ALERT_EVALUATION_DELAY = MINUTE;

function deps(w: World) {
  return { control: w.control, projects: w.projects, channels: w.channels, digests: null, clock: w.clock, settings: DELIVERY };
}

async function evaluateAll(w: World, signals: readonly AlertSignal[]): Promise<AlertFiring[]> {
  const fired: AlertFiring[] = [];
  for (const signal of signals) fired.push(...(await evaluateIssueAlerts(PROJECT, signal, deps(w))));
  return fired;
}

describe('evaluateIssueAlerts', () => {
  it('New issue alert: Given a rule triggering on first seen, When a new issue is created, Then its actions run once', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf());

    const fired = await evaluateAll(w, await arrive(w, alertEvent(T0)));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.deliveries).toEqual([{ action: { kind: 'webhook', url: 'https://hooks.example/nightwatch' }, status: 'delivered' }]);
    expect(w.webhook.delivered).toHaveLength(1);
    expect(w.webhook.delivered[0]?.destination).toEqual({ kind: 'webhook', url: 'https://hooks.example/nightwatch' });
    expect(w.webhook.delivered[0]?.message).toMatchObject({
      projectId: PROJECT,
      ruleId: 'rule-1',
      subject: 'Alert: TypeError: x is undefined',
    });

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + 2 * HOUR)))).toEqual([]);
    expect(w.webhook.delivered).toHaveLength(1);
  });

  it('Quiet period: Given a rule fired for an issue, When the trigger is met again inside the Alert Quiet Period, Then the actions do not run', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf({ triggers: [{ kind: 'every_event' }], quietPeriodMs: 30 * MINUTE }));

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0)))).toHaveLength(1);
    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + 10 * MINUTE)))).toEqual([]);
    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + 29 * MINUTE)))).toEqual([]);
    expect(w.webhook.delivered).toHaveLength(1);

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + 31 * MINUTE)))).toHaveLength(1);
    expect(w.webhook.delivered).toHaveLength(2);
  });

  it('Frequency alert: Given a rule triggering on more than N events in a window, When the Nth plus one event arrives, Then the actions run within the Alert Evaluation Delay', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf({ triggers: [{ kind: 'event_frequency', count: 3, windowMs: HOUR }] }));

    for (const at of [T0, T0 + MINUTE, T0 + 2 * MINUTE]) expect(await evaluateAll(w, await arrive(w, alertEvent(at)))).toEqual([]);
    const fourth = alertEvent(T0 + 3 * MINUTE);
    const fired = await evaluateAll(w, await arrive(w, fourth));

    expect(fired).toHaveLength(1);
    expect((fired[0]?.at ?? Infinity) - fourth.at).toBeLessThanOrEqual(ALERT_EVALUATION_DELAY);
    expect(w.webhook.delivered).toHaveLength(1);
  });

  it('Frequency alert: Given a rule counting users, When the window holds more distinct users than N, Then the actions run', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf({ triggers: [{ kind: 'user_frequency', count: 1, windowMs: HOUR }] }));

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0, { userKey: 'user-a' })))).toEqual([]);
    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + MINUTE, { userKey: 'user-a' })))).toEqual([]);
    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + 2 * MINUTE, { userKey: 'user-b' })))).toHaveLength(1);
  });

  it('Filter blocks: Given a rule filtered to environment production, When a staging event meets the trigger, Then the actions do not run', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf({ filters: [{ kind: 'environment', environment: 'production' }] }));

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0, { environment: 'staging' }), ['fp-staging']))).toEqual([]);
    expect(w.webhook.attempts).toEqual([]);

    expect(await evaluateAll(w, await arrive(w, alertEvent(T0 + MINUTE, { environment: 'production' }), ['fp-production']))).toHaveLength(
      1,
    );
  });

  it('Undelivered alert is visible: Given an Issue Alert Rule whose email or webhook action cannot be delivered, When Nightwatch stops trying, Then Members see on the rule that the action was not delivered', async () => {
    const w = world();
    const email = { kind: 'email', to: { kind: 'member', member: MIA.member } } as const;
    const webhook = { kind: 'webhook', url: 'https://hooks.example/down' } as const;
    w.control.addIssueAlertRule(PROJECT, ruleOf({ actions: [email, webhook] }));
    w.webhook.failure = { retryable: true };

    const [fired] = await evaluateAll(w, await arrive(w, alertEvent(T0)));

    expect(w.webhook.attempts).toHaveLength(DELIVERY.deliveryAttempts);
    expect(w.email.delivered.map((delivery) => delivery.destination)).toEqual([{ kind: 'email', address: MIA_EMAIL }]);
    expect(fired?.deliveries).toEqual([
      { action: email, status: 'delivered' },
      { action: webhook, status: 'undelivered' },
    ]);
    const onRule = await w.projects.firingsOf(PROJECT, 'rule-1');
    expect(onRule).toEqual([fired]);
    expect(onRule.flatMap(undeliveredActions)).toEqual([webhook]);
  });

  it('Undelivered alert is visible: a failure that retrying cannot fix stops at once, and the same delivery identity is used on every attempt', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf());
    w.webhook.failure = { retryable: false };

    const [fired] = await evaluateAll(w, await arrive(w, alertEvent(T0)));
    expect(w.webhook.attempts).toHaveLength(1);
    expect(fired && undeliveredActions(fired)).toEqual([{ kind: 'webhook', url: 'https://hooks.example/nightwatch' }]);

    const retried = world();
    retried.control.addIssueAlertRule(PROJECT, ruleOf());
    retried.webhook.failures = 2;
    const [delivered] = await evaluateAll(retried, await arrive(retried, alertEvent(T0)));
    expect(delivered?.deliveries.map((delivery) => delivery.status)).toEqual(['delivered']);
    expect(new Set(retried.webhook.attempts.map((attempt) => attempt.message.deliveryId)).size).toBe(1);
  });

  it('sends an email action to nobody as undelivered, and records it on the rule', async () => {
    const w = world();
    w.control.addIssueAlertRule(PROJECT, ruleOf({ actions: [{ kind: 'email', to: { kind: 'team', team: 'nobody' } }] }));
    const [fired] = await evaluateAll(w, await arrive(w, alertEvent(T0)));
    expect(fired?.deliveries.map((delivery) => delivery.status)).toEqual(['undelivered']);
  });
});
