/**
 * StreamPumpDO's steps, as module functions so no step is a method a bound
 * Worker could call by another name (architecture, Security mitigations:
 * RPC exposure). A kick names the pump and arms its alarm if none is set;
 * the alarm runs pumpArrivals under the pump's name as its worker id, then
 * re-arms one interval later, so a pump keeps pulling once started. A run
 * that throws is logged and the alarm re-armed all the same; its leased
 * records come back when their leases run out.
 */

import { processArrival } from '../../application/process-arrival.js';
import { pumpArrivals, type PumpArrivalsDeps } from '../../application/pump-arrivals.js';
import type { ArrivalRecord } from '../../domain/ingest/arrival.js';
import type { Outcome } from '../../domain/outcome/outcome.js';
import { SUBSCRIPTION, type PumpPlan, type PumpPorts } from './deps.js';

/** What one StreamPumpDO hands its steps. */
export type PumpRuntime = { readonly storage: DurableObjectStorage; readonly ports: PumpPorts; readonly plan: PumpPlan };

const NAME_KEY = 'pump-name';

// --- helpers ---

/** The name of the n-th pump; the pump's object and its worker id both carry it. */
export function pumpName(index: number): string {
  return `pump-${index}`;
}

export function pumpNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => pumpName(index));
}

function pumpDeps({ ports, plan }: PumpRuntime, workerId: string): PumpArrivalsDeps {
  const { subscription, blobs, archive, clock, process } = ports;
  return {
    subscription,
    blobs,
    archive,
    clock,
    dispatch: (record: ArrivalRecord) => processArrival(record, process),
    pump: { subscription: SUBSCRIPTION, workerId },
    settings: plan.settings,
  };
}

// --- flow ---

/** Names the pump and starts its alarm chain; a pump already running is left as it is. */
export async function kickStep({ storage, now, name }: { storage: DurableObjectStorage; now: number; name: string }): Promise<void> {
  await storage.put(NAME_KEY, name);
  if ((await storage.getAlarm()) === null) await storage.setAlarm(now);
}

/** One pump run, then the next alarm. Answers the run's Outcomes; none when the pump was never kicked or the run failed. */
export async function pumpStep(runtime: PumpRuntime): Promise<Outcome[]> {
  const name = await runtime.storage.get<string>(NAME_KEY);
  if (name === undefined) return [];
  try {
    return await pumpArrivals(pumpDeps(runtime, name));
  } catch (error) {
    console.error(JSON.stringify({ event: 'pump.run-failed', pump: name, error: String(error) }));
    return [];
  } finally {
    await runtime.storage.setAlarm(runtime.ports.clock.now() + runtime.plan.intervalMs);
  }
}
