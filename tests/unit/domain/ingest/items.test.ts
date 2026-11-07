import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Arrival, EndpointKind } from '../../../../src/domain/ingest/arrival.js';
import { arrivalEnvelope, classifyItem } from '../../../../src/domain/ingest/items.js';
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
    fc.assert(fc.property(fc.string(), (type) => expect(['in', 'out', 'unknown']).toContain(classifyItem(type).scope)));
  });
});
