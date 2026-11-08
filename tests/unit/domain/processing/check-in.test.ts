import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { monitorCheckIn } from '../../../../src/domain/processing/check-in.js';
import type { EnvelopeItem } from '../../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const enc = (s: string) => new TextEncoder().encode(s);

function item(payload: unknown): EnvelopeItem {
  return { header: { type: 'check_in' }, payload: enc(typeof payload === 'string' ? payload : JSON.stringify(payload)) };
}

describe('monitorCheckIn', () => {
  it('reads the monitor and status a check_in item names, for the Project of its record', () => {
    expect(monitorCheckIn(item({ check_in_id: 'c1', monitor_slug: 'nightly-backup', status: 'in_progress' }), 'p1')).toEqual({
      projectId: 'p1',
      monitorId: 'nightly-backup',
      status: 'in_progress',
    });
  });

  it('refuses an item that is not JSON, names no monitor, or carries a status monitors do not take', () => {
    for (const payload of ['{nope', { status: 'ok' }, { monitor_slug: '', status: 'ok' }, { monitor_slug: 'm', status: 'late' }]) {
      expect(monitorCheckIn(item(payload), 'p1')).toEqual({ refusal: 'malformed-check-in' });
    }
  });

  it('takes exactly the three check-in statuses', () => {
    fc.assert(
      fc.property(fc.string(), (status) => {
        const read = monitorCheckIn(item({ monitor_slug: 'm', status }), 'p1');
        expect(!isRefusal(read)).toBe(['in_progress', 'ok', 'error'].includes(status));
      }),
    );
  });
});
