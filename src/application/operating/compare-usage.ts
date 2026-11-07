/**
 * compareUsage -- the scheduler compares Platform Usage with the Platform
 * Soft Limits (design Behaviors: Soft limit crossed; Goals G20;
 * architecture Retention, archive and usage: run once per Platform Usage
 * Interval). Each product over its limit alerts every operator Destination
 * through the Channel of its kind. That alert is the only effect: no
 * Arrival is refused for a crossing.
 *
 * A failed delivery does not stop the others; the next comparison alerts
 * again while the product stays over, which bounds how late the operator
 * hears of it by the Platform Usage Interval.
 *
 * Ports: UsageSource, Channel, Clock.
 */

import type { AlertMessage } from '../../domain/alerts/alert-message.js';
import {
  comparePlatformUsage,
  softLimitMessage,
  type PlatformSoftLimits,
  type PlatformUsage,
} from '../../domain/operating/platform-usage.js';
import type { Channel, Destination } from '../../ports/channel.js';
import type { Clock } from '../../ports/clock.js';
import type { UsageSource } from '../../ports/usage-source.js';

/** `limits` and `operator` are scheduler settings: one limit per product, and where the operator is alerted. */
export type CompareUsageDeps = {
  usage: UsageSource;
  channels: readonly Channel[];
  clock: Clock;
  limits: PlatformSoftLimits;
  operator: readonly Destination[];
};

// --- flow ---

async function deliver(message: AlertMessage, destination: Destination, channels: readonly Channel[]): Promise<void> {
  const channel = channels.find((candidate) => candidate.kind === destination.kind);
  if (channel !== undefined) await channel.deliver(destination, message);
}

async function alertOperator(message: AlertMessage, deps: CompareUsageDeps): Promise<void> {
  for (const destination of deps.operator) await deliver(message, destination, deps.channels);
}

// --- exports ---

export async function compareUsage(deps: CompareUsageDeps): Promise<PlatformUsage[]> {
  const at = deps.clock.now();
  const compared = comparePlatformUsage(await deps.usage.usage(), deps.limits);
  for (const usage of compared.filter((product) => product.over)) await alertOperator(softLimitMessage({ usage, at }), deps);
  return compared;
}
