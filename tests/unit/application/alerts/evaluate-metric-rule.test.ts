import { describe, expect, it } from 'vitest';
import { evaluateMetricRule } from '../../../../src/application/alerts/evaluate-metric-rule.js';
import type { MetricAlertRule } from '../../../../src/domain/alerts/metric-incident.js';
import { DELIVERY, HOUR, MIA, MIA_EMAIL, MINUTE, PROJECT, T0, alertEvent, arrive, world, type World } from './world.js';

const RULE: MetricAlertRule = {
  ruleId: 'metric-1',
  aggregate: 'event_count',
  windowMs: HOUR,
  comparison: 'above',
  critical: 3,
  warning: null,
  resolve: null,
  breachesToOpen: 2,
  recoveriesToClose: 2,
};

const WEBHOOK = { kind: 'webhook', url: 'https://hooks.example/incidents' } as const;
const EMAIL = { kind: 'email', to: { kind: 'member', member: MIA.member } } as const;

function deps(w: World) {
  return { projects: w.projects, control: w.control, incidents: w.incidents, channels: w.channels, clock: w.clock, settings: DELIVERY };
}

async function evaluateAt(w: World, at: number) {
  w.clock.set(at);
  return evaluateMetricRule(RULE, { projectId: PROJECT, actions: [WEBHOOK, EMAIL] }, deps(w));
}

describe('evaluateMetricRule', () => {
  it('Metric incident opens and closes: Given a metric rule, When its aggregate breaches for the required consecutive windows, Then an Incident opens; When it recovers for the required windows, Then the Incident closes, and each change notifies', async () => {
    const w = world();
    for (let i = 0; i < 5; i += 1) await arrive(w, alertEvent(T0 + i * MINUTE), [`fp-${i}`]);

    expect(await evaluateAt(w, T0 + 10 * MINUTE)).toBeNull();
    expect(w.webhook.delivered).toEqual([]);
    const opened = await evaluateAt(w, T0 + 20 * MINUTE);
    expect(opened).toEqual({ ruleId: 'metric-1', from: 'closed', to: 'critical', at: T0 + 20 * MINUTE, value: 5, actor: 'system' });
    expect(w.webhook.delivered.map((delivery) => delivery.message.subject)).toEqual(['Incident critical: metric-1']);
    expect(w.email.delivered.map((delivery) => delivery.destination)).toEqual([{ kind: 'email', address: MIA_EMAIL }]);
    expect((await w.incidents.get('metric-1'))?.level).toBe('critical');

    expect(await evaluateAt(w, T0 + 3 * HOUR)).toBeNull();
    const closed = await evaluateAt(w, T0 + 4 * HOUR);
    expect(closed).toMatchObject({ from: 'critical', to: 'closed', value: 0 });
    expect(w.webhook.delivered.map((delivery) => delivery.message.subject)).toEqual([
      'Incident critical: metric-1',
      'Incident closed: metric-1',
    ]);
    expect((await w.incidents.get('metric-1'))?.level).toBe('closed');
  });

  it('changes nothing when the Project cannot measure the aggregate', async () => {
    const w = world();
    w.clock.set(T0);
    const rule: MetricAlertRule = { ...RULE, aggregate: 'crash_free_rate', comparison: 'below', critical: 99 };
    expect(await evaluateMetricRule(rule, { projectId: PROJECT, actions: [WEBHOOK] }, deps(w))).toBeNull();
    expect(await w.incidents.get('metric-1')).toBeNull();
  });
});
