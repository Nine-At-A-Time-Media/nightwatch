// The pump's rules: when a record has failed past its retry bound, where it
// is dead-lettered, what is written there, and the Outcome it ends in.
// Values in, values out; no fakes.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ArrivalRecord } from '../../../../src/domain/ingest/arrival.js';
import type { LeasedRecord } from '../../../../src/domain/ingest/subscription.js';
import {
  deadLetter,
  deadLetterKey,
  deadLetterOutcome,
  failureText,
  isPastRetryBound,
  settledOffsets,
  type Settlement,
} from '../../../../src/domain/processing/pump.js';

// --- builders ---

const RECEIVED = 1_800_000_000_000;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const inline: ArrivalRecord = {
  id: 'r1',
  projectId: 'p1',
  receivedAt: RECEIVED,
  endpoint: 'envelope',
  body: enc('{}\n{"type":"event"}\n{}'),
  blobKey: null,
  assertion: null,
};

const stored: ArrivalRecord = { ...inline, id: 'r2', body: null, blobKey: 'raw/p1/r2', assertion: 'jwt' };

function leased(record: ArrivalRecord, deliveries: number): LeasedRecord {
  return { offset: 7, record, deliveries };
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

// --- tests ---

describe('isPastRetryBound', () => {
  it('a record is past its bound once it has been delivered as many times as the bound allows', () => {
    expect(isPastRetryBound(leased(inline, 2), 3)).toBe(false);
    expect(isPastRetryBound(leased(inline, 3), 3)).toBe(true);
    expect(isPastRetryBound(leased(inline, 4), 3)).toBe(true);
  });

  it('is monotonic: a later delivery of a record past its bound is past it too', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 1000 }), (deliveries, bound) => {
        if (isPastRetryBound(leased(inline, deliveries), bound)) expect(isPastRetryBound(leased(inline, deliveries + 1), bound)).toBe(true);
      }),
    );
  });
});

describe('deadLetterKey', () => {
  it('a dead-lettered record is kept under deadletter/ by its record id', () => {
    expect(deadLetterKey(inline)).toBe('deadletter/r1');
  });
});

describe('deadLetterOutcome', () => {
  it('a dead-lettered record ends discarded, with reason dead-letter, recorded at its receipt', () => {
    expect(deadLetterOutcome(inline)).toEqual({
      projectId: 'p1',
      recordedAt: RECEIVED,
      kind: 'discarded',
      reason: 'dead-letter',
      category: 'default',
      quantity: 1,
    });
  });
});

describe('deadLetter', () => {
  it('carries the record as retained, its offset and deliveries, the failure and when it was dead-lettered', () => {
    const letter = JSON.parse(dec(deadLetter({ leased: leased(stored, 5), failure: 'boom', at: RECEIVED + 9 })));
    expect(letter).toEqual({
      record: { id: 'r2', projectId: 'p1', receivedAt: RECEIVED, endpoint: 'envelope', body: null, blobKey: 'raw/p1/r2', assertion: 'jwt' },
      offset: 7,
      deliveries: 5,
      failure: 'boom',
      deadLetteredAt: RECEIVED + 9,
    });
  });

  it('keeps an inline body byte for byte, as base64', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const letter = JSON.parse(dec(deadLetter({ leased: leased({ ...inline, body: bytes }, 1), failure: 'x', at: 0 })));
        expect(fromBase64(letter.record.body)).toEqual(bytes);
      }),
    );
  });
});

describe('failureText', () => {
  it('names an Error by its message and anything else by its text', () => {
    expect(failureText(new Error('write failed'))).toBe('Error: write failed');
    expect(failureText('plain')).toBe('plain');
  });
});

describe('settledOffsets', () => {
  it('splits the batch into offsets to ack and offsets to nack, in batch order', () => {
    const settlements: Settlement[] = [
      { offset: 1, disposition: 'ack', outcomes: [], deadLettered: null },
      { offset: 2, disposition: 'nack', outcomes: [], deadLettered: null },
      { offset: 3, disposition: 'ack', outcomes: [], deadLettered: deadLetterOutcome(inline) },
    ];
    expect(settledOffsets(settlements)).toEqual({ ack: [1, 3], nack: [2] });
  });
});
