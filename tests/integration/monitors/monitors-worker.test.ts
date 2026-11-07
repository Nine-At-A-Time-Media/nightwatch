// The monitors Worker in workerd: MonitorDO advances a Cron Monitor on its
// alarm and on a forwarded check-in, and an Uptime Monitor on each alarm
// through the real fetch probe (the test network answers by host);
// monitor issues open in the Project's ProjectDO. MetricRuleDO evaluates its
// rule on its alarm against the Project's counters.
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import type { MetricAlertRule } from '../../../src/domain/alerts/metric-incident.js';
import { newCronMonitor, type CronMonitorConfig } from '../../../src/domain/monitor/cron-monitor.js';
import type { CronMonitor, Monitor, UptimeMonitor } from '../../../src/domain/monitor/monitor.js';
import { NEW_UPTIME_MONITOR } from '../../../src/domain/monitor/uptime-monitor.js';

const MINUTE = 60_000;

const cronConfig: CronMonitorConfig = {
  schedule: { kind: 'interval', every: 1, unit: 'minute' },
  margin: 0,
  maxRuntime: 10 * MINUTE,
  thresholds: { failureThreshold: 2, recoveryThreshold: 1 },
};

const project = () => `project-${crypto.randomUUID()}`;
const projects = () => new DurableProjectClient({ namespace: env.PROJECT });

function monitorStub(monitor: Pick<Monitor, 'projectId' | 'monitorId'>) {
  return env.MONITOR.get(env.MONITOR.idFromName(`${monitor.projectId}/${monitor.monitorId}`));
}

/** A Cron Monitor whose expected run passed `overdue` ms ago. */
function cronMonitor(projectId: string, overdue: number): CronMonitor {
  const state = newCronMonitor(cronConfig, Date.now() - overdue - MINUTE);
  return { kind: 'cron', monitorId: 'nightly', projectId, issueId: null, config: cronConfig, state };
}

function uptimeMonitor(projectId: string, url: string): UptimeMonitor {
  return {
    kind: 'uptime',
    monitorId: 'health',
    projectId,
    issueId: null,
    url,
    interval: MINUTE,
    config: { uptimeFailureCount: 1, recoveryCount: 1 },
    state: NEW_UPTIME_MONITOR,
  };
}

function checkIn(body: object): Promise<Response> {
  return exports.default.fetch('https://monitors.internal/check-in', { method: 'POST', body: JSON.stringify(body) });
}

describe('MonitorDO', () => {
  it('Missed check-in -- Given a Cron Monitor, When no check-in arrives by its expected time plus margin, Then a missed Failure is recorded, and at the threshold a monitor issue opens', async () => {
    const monitor = cronMonitor(project(), 30_000);
    const stub = monitorStub(monitor);
    await stub.configure(monitor);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await stub.failures('nightly')).map((failure) => failure.kind)).toEqual(['missed']);
    expect((await stub.monitor('nightly'))?.issueId).toBeNull();

    await runInDurableObject(stub, async (_instance, state) => {
      const held = (await state.storage.get<CronMonitor>('monitor')) as CronMonitor;
      await state.storage.put('monitor', { ...held, state: { ...held.state, expectedAt: Date.now() - 1000 } });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect((await stub.failures('nightly')).map((failure) => failure.kind)).toEqual(['missed', 'missed']);
    const issueId = (await stub.monitor('nightly'))?.issueId;
    expect(issueId).toEqual(expect.any(String));
    expect(await projects().getIssue(monitor.projectId, issueId ?? '')).toMatchObject({ status: 'unresolved', substatus: 'new' });
  });

  it('sets its alarm to the expected run plus margin, and to the maximum runtime once a run starts', async () => {
    const monitor = cronMonitor(project(), -30_000);
    const stub = monitorStub(monitor);
    await stub.configure(monitor);
    const alarm = () => runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(await alarm()).toBe(monitor.state.expectedAt);

    const before = Date.now();
    expect(await checkIn({ projectId: monitor.projectId, monitorId: 'nightly', status: 'in_progress' })).toHaveProperty('status', 200);
    expect(await alarm()).toBeGreaterThanOrEqual(before + cronConfig.maxRuntime);
  });

  it('a check-in naming a monitor the Project does not have is refused', async () => {
    const monitor = cronMonitor(project(), -30_000);
    await monitorStub(monitor).configure(monitor);
    const response = await checkIn({ projectId: project(), monitorId: 'nightly', status: 'ok' });
    expect(response.status).toBe(404);
    expect(await checkIn({ projectId: monitor.projectId, monitorId: 'nightly', status: 'late' })).toHaveProperty('status', 400);
  });

  it('URL down -- Given an Uptime Monitor, When checks fail past the Uptime Failure Count, Then a monitor issue opens', async () => {
    const monitor = uptimeMonitor(project(), 'https://down.example.test/health');
    const stub = monitorStub(monitor);
    await stub.configure(monitor);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await stub.failures('health')).toEqual([{ kind: 'down', at: expect.any(Number), reason: 'status 503' }]);
    const issueId = (await stub.monitor('health'))?.issueId ?? '';
    expect(await projects().getIssue(monitor.projectId, issueId)).toMatchObject({ status: 'unresolved' });
    const next = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(Date.now() + MINUTE / 2);
  });

  it('an Uptime Monitor whose URL answers stays OK', async () => {
    const monitor = uptimeMonitor(project(), 'https://up.example.test/health');
    const stub = monitorStub(monitor);
    await stub.configure(monitor);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.failures('health')).toEqual([]);
    expect(await stub.monitor('health')).toMatchObject({ issueId: null, state: { counts: { status: 'ok' } } });
  });
});

describe('MetricRuleDO', () => {
  const rule: MetricAlertRule = {
    ruleId: 'rule-events',
    aggregate: 'event_count',
    windowMs: 60 * MINUTE,
    comparison: 'above',
    critical: 0,
    warning: null,
    resolve: null,
    breachesToOpen: 1,
    recoveriesToClose: 1,
  };

  it('Metric incident opens and closes -- Given a metric rule, When its aggregate breaches for the required windows, Then an Incident opens', async () => {
    const projectId = project();
    await projects().assignEvent(
      projectId,
      {
        eventId: 'event-1',
        at: Date.now(),
        release: null,
        environment: 'production',
        level: 'error',
        userKey: null,
        title: 'TypeError',
        culprit: null,
      },
      ['fp-1'],
    );
    const stub = env.METRIC_RULE.get(env.METRIC_RULE.idFromName(`${projectId}/${rule.ruleId}`));
    expect(await stub.configure({ rule, target: { projectId, actions: [] }, resolution: MINUTE })).toBeNull();

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await stub.incident()).toMatchObject({ level: 'critical' });
    const next = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(Date.now());
  });

  it('refuses a rule with an empty resolution', async () => {
    const stub = env.METRIC_RULE.get(env.METRIC_RULE.idFromName(`${project()}/${rule.ruleId}`));
    expect(await stub.configure({ rule, target: { projectId: project(), actions: [] }, resolution: 0 })).toEqual({
      refusal: 'metric_alert_rule_invalid',
    });
  });
});
