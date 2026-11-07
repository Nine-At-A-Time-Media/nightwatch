// R2NdjsonArchiveSink -- the local stand-in for the Basin archive (architecture
// A14): each batch of Outcomes lands as NDJSON objects in R2, partitioned by
// the UTC day each Outcome was recorded, and reads back exactly.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { R2NdjsonArchiveSink } from '../../../src/adapters/r2-ndjson/r2-ndjson-archive-sink.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import type { Outcome } from '../../../src/domain/outcome/outcome.js';
import { FakeIds } from '../../_fakes/fake-ids.js';

const DAY_ONE = Date.UTC(2023, 10, 14, 23, 59, 59);
const DAY_TWO = Date.UTC(2023, 10, 15, 0, 0, 1);

function outcome(recordedAt: number, kind: Outcome['kind']): Outcome {
  return { projectId: '42', recordedAt, kind, reason: kind === 'accepted' ? null : 'quota-exceeded', category: 'error', quantity: 1 };
}

async function readNdjson(key: string): Promise<unknown[]> {
  const object = await env.BLOBS.get(key);
  const text = object === null ? '' : await object.text();
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

describe('R2NdjsonArchiveSink', () => {
  it('writes each UTC day of Outcomes to its own dt= partition, one JSON line per Outcome', async () => {
    const prefix = crypto.randomUUID();
    const sink = new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids: new FakeIds(prefix) });
    const batch = [outcome(DAY_ONE, 'accepted'), outcome(DAY_TWO, 'rate_limited'), outcome(DAY_ONE, 'rate_limited')];
    await sink.outcomes(batch);
    expect(await readNdjson(`archive/outcomes/dt=2023-11-14/${prefix}-1.ndjson`)).toEqual([batch[0], batch[2]]);
    expect(await readNdjson(`archive/outcomes/dt=2023-11-15/${prefix}-2.ndjson`)).toEqual([batch[1]]);
  });

  it('writes nothing for an empty batch', async () => {
    const prefix = crypto.randomUUID();
    await new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids: new FakeIds(prefix) }).outcomes([]);
    const listed = await env.BLOBS.list({ prefix: 'archive/outcomes/' });
    expect(listed.objects.filter((o) => o.key.includes(prefix))).toEqual([]);
  });

  it('writes each UTC day of Event Summaries to its own dt= partition under events, each line naming its Project', async () => {
    const prefix = crypto.randomUUID();
    const sink = new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids: new FakeIds(prefix) });
    const summary: EventSummary = {
      eventId: 'a'.repeat(32),
      at: DAY_TWO,
      release: 'web@1.0.0',
      environment: 'production',
      level: 'error',
      userKey: null,
      title: 'TypeError: x',
      culprit: null,
    };
    await sink.events('42', [summary]);
    expect(await readNdjson(`archive/events/dt=2023-11-15/${prefix}-1.ndjson`)).toEqual([{ projectId: '42', ...summary }]);
  });
});
