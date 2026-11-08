import { describe, expect, it } from 'vitest';
import { deliverDigest } from '../../../../src/application/alerts/deliver-digest.js';
import { evaluateIssueAlerts } from '../../../../src/application/alerts/evaluate-issue-alerts.js';
import { DELIVERY, DIGEST_POLICY, MIA_EMAIL, MINUTE, PROJECT, T0, alertEvent, arrive, ruleOf, world, type World } from './world.js';

const KEY = { ruleId: 'rule-1', recipient: MIA_EMAIL };

async function alertOn(w: World, at: number, fingerprint: string, title: string): Promise<void> {
  const deps = {
    control: w.control,
    projects: w.projects,
    channels: w.channels,
    digests: w.digestQueue,
    clock: w.clock,
    settings: DELIVERY,
  };
  for (const signal of await arrive(w, alertEvent(at, { title }), [fingerprint])) await evaluateIssueAlerts(PROJECT, signal, deps);
}

describe('deliverDigest', () => {
  it('Digest gathers: Given several alerts for one recipient and rule in a burst, When the Digest is due, Then one email lists them all', async () => {
    const w = world();
    w.control.addIssueAlertRule(
      PROJECT,
      ruleOf({ triggers: [{ kind: 'every_event' }], quietPeriodMs: 1, actions: [{ kind: 'email', to: { kind: 'owners' } }] }),
    );
    await alertOn(w, T0, 'fp-a', 'TypeError: x is undefined');
    await alertOn(w, T0 + MINUTE, 'fp-b', 'RangeError: bad length');
    await alertOn(w, T0 + 2 * MINUTE, 'fp-a', 'TypeError: x is undefined');

    expect(w.email.attempts).toEqual([]);
    expect(w.digestQueue.keys()).toEqual([KEY]);
    const digest = await w.digestQueue.take(KEY);
    const deps = { mailer: w.mailer, clock: w.clock, policy: DIGEST_POLICY };

    w.clock.set(T0 + 4 * MINUTE);
    expect(await deliverDigest(digest, deps)).toEqual(digest);
    expect(w.mailer.sent).toEqual([]);

    w.clock.set(T0 + DIGEST_POLICY.minimumDelayMs);
    const left = await deliverDigest(digest, deps);
    expect(w.mailer.sent).toEqual([
      {
        to: MIA_EMAIL,
        subject: '3 alerts from rule rule-1',
        text: 'TypeError: x is undefined (2 alerts)\nRangeError: bad length (1 alert)',
        headers: {},
      },
    ]);
    expect(left.items).toEqual([]);
    expect(await deliverDigest(left, deps)).toEqual(left);
    expect(w.mailer.sent).toHaveLength(1);
  });

  it('keeps a Digest whose email was not sent, so its runtime can try again', async () => {
    const w = world();
    const digest = { ruleId: 'rule-1', recipient: MIA_EMAIL, items: [{ issueId: 'issue-1', title: 'TypeError', at: T0 }] };
    w.mailer.failure = { retryable: true };
    w.clock.set(T0 + DIGEST_POLICY.maximumDelayMs);
    expect(await deliverDigest(digest, { mailer: w.mailer, clock: w.clock, policy: DIGEST_POLICY })).toEqual(digest);
  });
});
