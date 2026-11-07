import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Arrival, EndpointKind } from '../../../../src/domain/ingest/arrival.js';
import {
  applyInboundFilters,
  arrivalEnvelope,
  classifyItem,
  isOversizeArrival,
  keptBody,
  triageItems,
} from '../../../../src/domain/ingest/items.js';
import { parseEnvelope, type Envelope } from '../../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const enc = (s: string) => new TextEncoder().encode(s);

const arrival = (endpoint: EndpointKind, body: string): Arrival => ({
  projectId: '1',
  endpoint,
  headers: {},
  query: {},
  pathKey: null,
  origin: null,
  body: enc(body),
});

describe('arrivalEnvelope', () => {
  it('parses an envelope arrival into its items', () => {
    const env = arrivalEnvelope(arrival('envelope', '{}\n{"type":"event"}\n{}\n{"type":"session"}\n{}\n'));
    if (isRefusal(env)) throw new Error(env.refusal);
    expect(env.items.map((i) => i.header.type)).toEqual(['event', 'session']);
  });

  it('refuses an envelope it cannot parse', () => {
    expect(arrivalEnvelope(arrival('envelope', 'nope\n'))).toEqual({ refusal: 'malformed-envelope-header' });
  });

  it('reads every other endpoint as one item of that endpoint kind carrying the whole body', () => {
    const cases: [EndpointKind, string][] = [
      ['store', 'event'],
      ['security', 'security'],
      ['attachment', 'attachment'],
      ['checkin', 'check_in'],
    ];
    for (const [endpoint, type] of cases) {
      const env = arrivalEnvelope(arrival(endpoint, 'payload'));
      if (isRefusal(env)) throw new Error(env.refusal);
      expect(env.items).toHaveLength(1);
      expect(env.items[0]!.header.type).toBe(type);
      expect(env.items[0]!.payload).toEqual(enc('payload'));
    }
  });
});

describe('classifyItem', () => {
  it('maps each in-scope item kind to its data category', () => {
    const expected = {
      event: 'error',
      attachment: 'attachment',
      session: 'session',
      sessions: 'session',
      feedback: 'feedback',
      user_report: 'feedback',
      check_in: 'monitor',
      security: 'security',
    };
    for (const [type, category] of Object.entries(expected)) expect(classifyItem(type)).toEqual({ scope: 'in', category });
  });

  it('calls any other kind unknown', () => {
    expect(classifyItem('no_such_kind')).toEqual({ scope: 'unknown' });
  });

  it('classifies any string without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (type) => {
        expect(['in', 'out', 'unknown']).toContain(classifyItem(type).scope);
      }),
    );
  });
});

const limits = { event: 10, attachment: 20, arrival: 30 };

const envelopeOf = (text: string): Envelope => {
  const env = parseEnvelope(enc(text));
  if (isRefusal(env)) throw new Error(env.refusal);
  return env;
};

describe('size limits', () => {
  it('an Arrival is oversize only when its body exceeds the Arrival size limit', () => {
    expect(isOversizeArrival({ arrival: arrival('envelope', 'x'.repeat(30)), limits })).toBe(false);
    expect(isOversizeArrival({ arrival: arrival('envelope', 'x'.repeat(31)), limits })).toBe(true);
  });

  it('an item over its limit is invalid as too-large; attachments use the Attachment size limit', () => {
    const env = envelopeOf(
      ['{}', '{"type":"event"}', '1234567890', '{"type":"event"}', '12345678901', '{"type":"attachment"}', '12345678901'].join('\n'),
    );
    const fates = triageItems({ envelope: env, limits });
    expect(fates.map((f) => [f.category, f.verdict])).toEqual([
      ['error', null],
      ['error', { kind: 'invalid', reason: 'too-large' }],
      ['attachment', null],
    ]);
  });
});

describe('keptBody', () => {
  it('is the body as received when every item is kept', () => {
    const text = '{"event_id":"e"}\n{"type":"event"}\n{}\n';
    const a = arrival('envelope', text);
    const env = envelopeOf(text);
    expect(keptBody({ arrival: a, envelope: env, fates: triageItems({ envelope: env, limits }) })).toBe(a.body);
  });

  it('is the envelope header and only the kept items when some item was dropped', () => {
    const text = '{"event_id":"e"}\n{"type":"event"}\n12345678901\n{"type":"session"}\n{}\n';
    const env = envelopeOf(text);
    const fates = triageItems({ envelope: env, limits });
    const kept = parseEnvelope(keptBody({ arrival: arrival('envelope', text), envelope: env, fates }));
    if (isRefusal(kept)) throw new Error(kept.refusal);
    expect(kept.header).toEqual({ event_id: 'e' });
    expect(kept.items.map((i) => i.header.type)).toEqual(['session']);
  });
});

describe('applyInboundFilters', () => {
  const filters = { browserExtensions: false, localhost: false, webCrawlers: true, releases: ['old'], messages: [], addresses: [] };

  it('filters an open event an Inbound Filter matches, naming the filter', () => {
    const env = envelopeOf('{}\n{"type":"event"}\n{"release":"old"}\n{"type":"event"}\n{"release":"new"}\n');
    const fates = applyInboundFilters({
      fates: triageItems({ envelope: env, limits: { ...limits, event: 100 } }),
      filters,
      userAgent: null,
    });
    expect(fates.map((f) => f.verdict)).toEqual([{ kind: 'filtered', reason: 'releases' }, null]);
  });

  it('passes the arrival user agent to the filters', () => {
    const env = envelopeOf('{}\n{"type":"event"}\n{}\n');
    const fates = applyInboundFilters({ fates: triageItems({ envelope: env, limits }), filters, userAgent: 'Googlebot/2.1' });
    expect(fates[0]!.verdict).toEqual({ kind: 'filtered', reason: 'web-crawlers' });
  });

  it('leaves items that are not events, and events it cannot parse, open', () => {
    const env = envelopeOf('{}\n{"type":"session"}\n{"release":"old"}\n{"type":"event"}\nnot json\n');
    const fates = applyInboundFilters({
      fates: triageItems({ envelope: env, limits: { ...limits, event: 100 } }),
      filters,
      userAgent: null,
    });
    expect(fates.map((f) => f.verdict)).toEqual([null, null]);
  });
});
