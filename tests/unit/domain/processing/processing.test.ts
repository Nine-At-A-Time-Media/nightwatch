import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ArrivalRecord } from '../../../../src/domain/ingest/arrival.js';
import type { Outcome } from '../../../../src/domain/outcome/outcome.js';
import { normalizeEvent, type NormalizedEvent } from '../../../../src/domain/normalize/normalize.js';
import { gv1 } from '../../../../src/domain/grouping/grouping-version.js';
import { feedbackSubmission } from '../../../../src/domain/processing/feedback.js';
import {
  encodeScrubbedEvent,
  itemPayload,
  mergeResults,
  normalizeContext,
  processingOutcome,
  processingResult,
  processingRoute,
  userKeyText,
  type ProcessingConfig,
} from '../../../../src/domain/processing/processing.js';
import type { EnvelopeItem } from '../../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

// --- builders ---

const RECEIVED = 1_800_000_000_000;
const enc = (s: string) => new TextEncoder().encode(s);

const record: ArrivalRecord = {
  id: 'r1',
  projectId: 'p1',
  receivedAt: RECEIVED,
  endpoint: 'envelope',
  body: enc(''),
  blobKey: null,
  assertion: null,
};

const config: ProcessingConfig = {
  scrubbing: { ipAddresses: false, project: [] },
  grouping: { version: gv1, fingerprintRules: [], stackTraceRules: [] },
  eventRetentionMs: 90 * 86_400_000,
};

function item(type: string, payload: unknown): EnvelopeItem {
  return { header: { type }, payload: enc(typeof payload === 'string' ? payload : JSON.stringify(payload)) };
}

function normalized(raw: Record<string, unknown>): NormalizedEvent {
  const result = normalizeEvent(
    { event_id: 'a'.repeat(32), ...raw },
    { receivedAt: new Date(RECEIVED), clampFutureMs: 60_000, retentionMs: 86_400_000, projectId: 'p1', maxTagValueLength: 200 },
  );
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

// --- routing ---

describe('processingRoute', () => {
  it('sends events to processing, feedback to filing, and defers every other kind', () => {
    const routes = ['event', 'feedback', 'user_report', 'check_in', 'session', 'sessions', 'attachment', 'security', 'mystery'].map(
      processingRoute,
    );
    expect(routes).toEqual(['event', 'feedback', 'feedback', 'deferred', 'deferred', 'deferred', 'deferred', 'deferred', 'deferred']);
  });
});

describe('processingOutcome', () => {
  it("records the item's fate in its own category, at receipt, in the record's Project, naming the item by its record and index", () => {
    const expected: Outcome = {
      projectId: 'p1',
      recordedAt: RECEIVED,
      kind: 'discarded',
      reason: 'deferred',
      category: 'monitor',
      quantity: 1,
      item: { recordId: 'r1', index: 2 },
    };
    expect(processingOutcome({ record, index: 2, type: 'check_in', kind: 'discarded', reason: 'deferred' })).toEqual(expected);
    expect(processingOutcome({ record, index: null, type: 'mystery', kind: 'invalid', reason: 'x' })).toMatchObject({
      category: 'default',
      item: { recordId: 'r1', index: null },
    });
  });
});

// --- reading items ---

describe('itemPayload', () => {
  it('reads the JSON an item carries, or nothing', () => {
    expect(itemPayload(item('event', { a: 1 }))).toEqual({ a: 1 });
    expect(itemPayload(item('event', '{not json'))).toBeUndefined();
  });
});

describe('normalizeContext', () => {
  it("takes receipt from the record, the sender's stamp and event id from the envelope, and bounds from settings and the Project", () => {
    const context = normalizeContext({
      record,
      header: { sent_at: '2027-01-15T08:00:00Z', event_id: 'b'.repeat(32) },
      config,
      settings: { clampFutureMs: 60_000, maxTagValueLength: 200 },
    });
    expect(context).toEqual({
      receivedAt: new Date(RECEIVED),
      sentAt: new Date('2027-01-15T08:00:00Z'),
      eventId: 'b'.repeat(32),
      clampFutureMs: 60_000,
      retentionMs: config.eventRetentionMs,
      projectId: 'p1',
      maxTagValueLength: 200,
    });
  });

  it('leaves out a stamp or event id the envelope does not carry usably', () => {
    const context = normalizeContext({
      record,
      header: { sent_at: 'yesterday', event_id: 7 },
      config,
      settings: { clampFutureMs: 1, maxTagValueLength: 1 },
    });
    expect(context).not.toHaveProperty('sentAt');
    expect(context).not.toHaveProperty('eventId');
  });
});

const PLACE = { recordId: 'rec-1', index: 2 };

describe('feedbackSubmission', () => {
  it('reads the message and associated event of a feedback item, keyed by its own event id', () => {
    const feedback = item('feedback', {
      event_id: 'f'.repeat(32),
      contexts: { feedback: { message: 'the save button does nothing', associated_event_id: 'c'.repeat(32) } },
    });
    expect(feedbackSubmission(feedback, PLACE)).toEqual({
      message: 'the save button does nothing',
      screenshot: null,
      associatedEventId: 'c'.repeat(32),
      filingKey: 'f'.repeat(32),
    });
    expect(feedbackSubmission(item('feedback', { contexts: {} }), PLACE)).toMatchObject({ filingKey: 'rec-1/2' });
  });

  it('reads the comments and event of a legacy user report, keyed by where it sits', () => {
    const report = item('user_report', { event_id: 'd'.repeat(32), name: 'Ada', email: 'ada@example.com', comments: 'it crashed' });
    expect(feedbackSubmission(report, PLACE)).toEqual({
      message: 'it crashed',
      screenshot: null,
      associatedEventId: 'd'.repeat(32),
      filingKey: 'rec-1/2',
    });
  });

  it('never trusts a name or address the item carries, and never throws on what it reads', () => {
    fc.assert(
      fc.property(fc.constantFrom('feedback', 'user_report'), fc.jsonValue(), (type, payload) => {
        const submission = feedbackSubmission(item(type, payload), PLACE);
        expect(typeof submission.message).toBe('string');
        expect(Object.keys(submission).sort()).toEqual(['associatedEventId', 'filingKey', 'message', 'screenshot']);
      }),
      { numRuns: 200 },
    );
  });
});

// --- the Event as stored ---

describe('userKeyText', () => {
  it("names the Event's user by id, else email, else username, else address", () => {
    expect(userKeyText(normalized({ user: { id: 7, email: 'ada@example.com' } }), [])).toBe('id:7');
    expect(userKeyText(normalized({ user: { email: 'ada@example.com', ip_address: '10.0.0.1' } }), [])).toBe('email:ada@example.com');
    expect(userKeyText(normalized({ user: { ip_address: '10.0.0.1' } }), [])).toBe('ip:10.0.0.1');
    expect(userKeyText(normalized({}), [])).toBeNull();
  });

  it('never keys by a field a Scrubbing Rule touched', () => {
    const event = normalized({ user: { id: 7, email: 'ada@example.com' } });
    const removal = { path: 'user.id', rule: 'p', method: 'replace' as const, originalLength: 1 };
    expect(userKeyText(event, [removal])).toBe('email:ada@example.com');
  });
});

describe('encodeScrubbedEvent', () => {
  it('stores the Event and its Removals together as JSON', () => {
    const event = normalized({ message: 'hi' });
    const removals = [{ path: 'extra.password', rule: 'built-in:sensitive-key', method: 'replace' as const, originalLength: 8 }];
    expect(JSON.parse(new TextDecoder().decode(encodeScrubbedEvent({ event, removals })))).toEqual({ event, removals });
  });
});

// --- the result ---

describe('ProcessingResult', () => {
  it('gathers the parts of every item in order', () => {
    const a: Outcome = { projectId: 'p1', recordedAt: RECEIVED, kind: 'invalid', reason: 'a', category: 'error', quantity: 1 };
    const b: Outcome = { ...a, reason: 'b' };
    const assignment = { issueId: 'i1', changes: [], duplicate: false };
    expect(mergeResults([processingResult({ outcomes: [a] }), processingResult({ assignments: [assignment], outcomes: [b] })])).toEqual({
      assignments: [assignment],
      filingReceipts: [],
      outcomes: [a, b],
    });
  });
});
