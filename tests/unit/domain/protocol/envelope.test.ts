import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseEnvelope, serializeEnvelope } from '../../../../src/domain/protocol/envelope.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('parseEnvelope', () => {
  it('reads an item whose payload length is declared, even when it contains newlines', () => {
    const env = parseEnvelope(enc('{"event_id":"e1"}\n{"type":"attachment","length":5}\na\nb\nc\n'));
    if (isRefusal(env)) throw new Error(env.refusal);
    expect(env.header).toEqual({ event_id: 'e1' });
    expect(env.items).toHaveLength(1);
    expect(dec(env.items[0]!.payload)).toBe('a\nb\nc');
  });

  it('reads an item without a length up to the next newline, with or without a trailing newline', () => {
    for (const tail of ['', '\n']) {
      const env = parseEnvelope(enc('{}\n{"type":"event"}\n{"message":"x"}\n{"type":"session"}\n{"sid":"s"}' + tail));
      if (isRefusal(env)) throw new Error(env.refusal);
      expect(env.items.map((i) => i.header.type)).toEqual(['event', 'session']);
      expect(JSON.parse(dec(env.items[1]!.payload))).toEqual({ sid: 's' });
    }
  });

  it('refuses a malformed header, an item without a type, or a payload shorter than its length', () => {
    expect(isRefusal(parseEnvelope(enc('not json\n')))).toBe(true);
    expect(isRefusal(parseEnvelope(enc('{}\n{"length":1}\na\n')))).toBe(true);
    expect(isRefusal(parseEnvelope(enc('{}\n{"type":"event","length":10}\nabc')))).toBe(true);
  });

  it('round-trips any envelope it serializes', () => {
    const item = fc.record({
      type: fc.constantFrom('event', 'attachment', 'feedback', 'session'),
      payload: fc.uint8Array({ maxLength: 64 }),
    });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 5 }), (items) => {
        const envelope = { header: { event_id: 'x' }, items: items.map((i) => ({ header: { type: i.type }, payload: i.payload })) };
        const parsed = parseEnvelope(serializeEnvelope(envelope));
        if (isRefusal(parsed)) throw new Error(parsed.refusal);
        expect(parsed.items.map((i) => [i.header.type, Array.from(i.payload)])).toEqual(items.map((i) => [i.type, Array.from(i.payload)]));
      }),
    );
  });
});
