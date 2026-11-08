import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sessionReports } from '../../../../src/domain/processing/sessions.js';
import type { EnvelopeItem } from '../../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const RECEIVED = Date.UTC(2026, 10, 7, 12, 30, 15);
const enc = (s: string) => new TextEncoder().encode(s);

function item(type: string, payload: unknown): EnvelopeItem {
  return { header: { type }, payload: enc(typeof payload === 'string' ? payload : JSON.stringify(payload)) };
}

const attrs = { release: 'web@1.0.0', environment: 'production' };

describe('sessionReports: a session update', () => {
  it('counts a Session on its first update, with its release, environment, status, start and distinct id', () => {
    const update = { sid: 's1', did: 'u-7', init: true, started: '2026-11-07T12:00:05Z', status: 'ok', attrs };
    expect(sessionReports(item('session', update), RECEIVED)).toEqual([
      { release: 'web@1.0.0', environment: 'production', status: 'ok', userText: 'id:u-7', startedAt: Date.UTC(2026, 10, 7, 12, 0, 5) },
    ]);
  });

  it('counts a first update that already ended in a crash as crashed, one with errors as errored, and later updates not at all', () => {
    const crashed = sessionReports(item('session', { init: true, status: 'crashed', attrs }), RECEIVED);
    const errored = sessionReports(item('session', { init: true, status: 'exited', errors: 2, attrs }), RECEIVED);
    const later = sessionReports(item('session', { init: false, status: 'crashed', attrs }), RECEIVED);
    expect(!isRefusal(crashed) && crashed.map((report) => report.status)).toEqual(['crashed']);
    expect(!isRefusal(errored) && errored.map((report) => report.status)).toEqual(['errored']);
    expect(later).toEqual([]);
  });

  it('takes production when no environment is named, the receipt when no start is, and no user when no distinct id is', () => {
    expect(sessionReports(item('session', { init: true, status: 'ok', attrs: { release: 'r1' } }), RECEIVED)).toEqual([
      { release: 'r1', environment: 'production', status: 'ok', userText: null, startedAt: RECEIVED },
    ]);
  });

  it('refuses an update that is not JSON, names no release, or has a status no Session ends in', () => {
    for (const payload of ['{nope', { init: true, status: 'ok' }, { init: true, status: 'sleepy', attrs }]) {
      expect(sessionReports(item('session', payload), RECEIVED)).toEqual({ refusal: 'malformed-session' });
    }
  });
});

describe('sessionReports: aggregated sessions', () => {
  it('counts each Session an aggregate row sums, by how it ended, in the minute it names', () => {
    const started = '2026-11-07T12:01:00Z';
    const reports = sessionReports(
      item('sessions', {
        attrs,
        aggregates: [
          { started, did: 'u-1', exited: 2, crashed: 1 },
          { started, errored: 1, abnormal: 1 },
        ],
      }),
      RECEIVED,
    );
    const at = Date.UTC(2026, 10, 7, 12, 1);
    const base = { release: 'web@1.0.0', environment: 'production', startedAt: at };
    expect(reports).toEqual([
      { ...base, status: 'exited', userText: 'id:u-1' },
      { ...base, status: 'exited', userText: 'id:u-1' },
      { ...base, status: 'crashed', userText: 'id:u-1' },
      { ...base, status: 'errored', userText: null },
      { ...base, status: 'abnormal', userText: null },
    ]);
  });

  it('counts as many Sessions as the rows sum, whatever the counts', () => {
    const count = fc.integer({ min: 0, max: 20 });
    const row = fc.record({ exited: count, errored: count, abnormal: count, crashed: count });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 4 }), (rows) => {
        const reports = sessionReports(item('sessions', { attrs, aggregates: rows }), RECEIVED);
        const sum = rows.reduce((total, r) => total + r.exited + r.errored + r.abnormal + r.crashed, 0);
        expect(!isRefusal(reports) && reports.length).toBe(sum);
      }),
    );
  });

  it('refuses aggregates with no release or no list of rows', () => {
    expect(sessionReports(item('sessions', { aggregates: [] }), RECEIVED)).toEqual({ refusal: 'malformed-session' });
    expect(sessionReports(item('sessions', { attrs }), RECEIVED)).toEqual({ refusal: 'malformed-session' });
  });
});
