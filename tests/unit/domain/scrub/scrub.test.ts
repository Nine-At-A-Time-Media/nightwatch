import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeEvent, type NormalizedEvent } from '../../../../src/domain/normalize/normalize.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { parseScrubbingRules, scrubbingRules, type ProjectScrubbingRule } from '../../../../src/domain/scrub/rules.js';
import { scrubEvent } from '../../../../src/domain/scrub/scrub.js';

// --- builders ---

const RECEIVED = new Date('2026-11-07T12:00:00Z');
const hash = (text: string): string => `hash-of-${text.length}`;

function normalized(raw: Record<string, unknown>): NormalizedEvent {
  const result = normalizeEvent(
    { event_id: 'e'.repeat(32), ...raw },
    { receivedAt: RECEIVED, clampFutureMs: 60_000, retentionMs: 86_400_000, projectId: 'p1', maxTagValueLength: 200 },
  );
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

function projectRules(raw: unknown): readonly ProjectScrubbingRule[] {
  const rules = parseScrubbingRules(raw);
  if (isRefusal(rules)) throw new Error(rules.refusal);
  return rules;
}

const defaults = scrubbingRules({ ipAddresses: false, project: [] });

// --- built-in rules ---

describe('scrubEvent built-in rules', () => {
  it('Scrubbing removes data: Given a Scrubbing Rule matches a field, When the event is processed, Then the stored event shows the field as removed with the rule and length', () => {
    const event = normalized({ extra: { password: 'hunter22', note: 'fine' } });
    const { event: scrubbed, removals } = scrubEvent(event, defaults, hash);
    expect(scrubbed.extra).toEqual({ password: '[Filtered]', note: 'fine' });
    expect(removals).toEqual([{ path: 'extra.password', rule: 'built-in:sensitive-key', method: 'replace', originalLength: 8 }]);
    expect(JSON.stringify({ scrubbed, removals })).not.toContain('hunter22');
  });

  it('removes credentials by key name wherever they sit, whole subtrees included', () => {
    const event = normalized({
      request: { headers: { Authorization: 'Basic dXNlcjpwYXNz', Cookie: 'sid=1', Accept: 'text/html' } },
      contexts: { app: { api_key: 'k-123', name: 'shop' } },
      breadcrumbs: [{ message: 'login', data: { credentials: { user: 'ada', pin: 1234 } } }],
      tags: { 'session-token': 'tok' },
    });
    const { event: scrubbed, removals } = scrubEvent(event, defaults, hash);
    expect(scrubbed.request?.headers).toEqual({ Authorization: '[Filtered]', Cookie: '[Filtered]', Accept: 'text/html' });
    expect(scrubbed.contexts).toEqual({ app: { api_key: '[Filtered]', name: 'shop' } });
    expect(scrubbed.breadcrumbs[0]?.data).toEqual({ credentials: { user: '[Filtered]', pin: '[Filtered]' } });
    expect(scrubbed.tags).toEqual({ 'session-token': '[Filtered]' });
    expect(removals.map((r) => [r.path, r.originalLength]).sort()).toEqual(
      [
        ['request.headers.Authorization', 18],
        ['request.headers.Cookie', 5],
        ['contexts.app.api_key', 5],
        ['breadcrumbs.0.data.credentials.user', 3],
        ['breadcrumbs.0.data.credentials.pin', 4],
        ['tags.session-token', 3],
      ].sort(),
    );
  });

  it('masks card numbers that pass the Luhn check and leaves other digit runs alone', () => {
    const event = normalized({ message: 'paid with 4111 1111 1111 1111, order 1234567890123' });
    const { event: scrubbed, removals } = scrubEvent(event, defaults, hash);
    expect(scrubbed.message?.formatted).toBe('paid with *******************, order 1234567890123');
    expect(removals).toEqual([{ path: 'message.formatted', rule: 'built-in:credit-card', method: 'mask', originalLength: 19 }]);
  });

  it('removes a bearer token inside any text', () => {
    const event = normalized({ breadcrumbs: [{ message: 'GET /me with Bearer abc.def-ghi' }] });
    const { event: scrubbed, removals } = scrubEvent(event, defaults, hash);
    expect(scrubbed.breadcrumbs[0]?.message).toBe('GET /me with Bearer [Filtered]');
    expect(removals).toEqual([{ path: 'breadcrumbs.0.message', rule: 'built-in:bearer-token', method: 'replace', originalLength: 11 }]);
  });

  it('removes IP addresses only when the project asks for it', () => {
    const event = normalized({ user: { id: 'u1', ip_address: '203.0.113.9' }, message: 'from 2001:db8::1 and 10.0.0.1' });
    expect(scrubEvent(event, defaults, hash).event.user).toEqual({ id: 'u1', ipAddress: '203.0.113.9' });
    const { event: scrubbed } = scrubEvent(event, scrubbingRules({ ipAddresses: true, project: [] }), hash);
    expect(scrubbed.user).toEqual({ id: 'u1', ipAddress: '[Filtered]' });
    expect(scrubbed.message?.formatted).toBe('from [Filtered] and [Filtered]');
  });

  it('never touches the identity, time or record of an event', () => {
    const event = normalized({ level: 'loud', extra: { token: 'x' } });
    const rules = scrubbingRules({ ipAddresses: true, project: projectRules([{ name: 'all', selector: '**', method: 'remove' }]) });
    const { event: scrubbed } = scrubEvent(event, rules, hash);
    expect(scrubbed).toMatchObject({
      eventId: event.eventId,
      projectId: 'p1',
      timestamp: event.timestamp,
      receivedAt: event.receivedAt,
      level: 'error',
      platform: 'other',
      errors: event.errors,
    });
  });
});

// --- project rules ---

describe('scrubEvent project rules', () => {
  const event = normalized({
    user: { id: 'u1', email: 'ada@example.com' },
    exception: [{ type: 'CardError', value: 'card 5555 refused' }],
    tags: { customer: 'acme' },
    extra: { order: { card: 'visa', total: 12 } },
  });

  it('applies each method by field path glob, first match wins', () => {
    const rules = scrubbingRules({
      ipAddresses: false,
      project: projectRules([
        { name: 'no-email', selector: 'user.email', method: 'remove' },
        { name: 'mask-values', selector: 'exceptions.*.value', method: 'mask' },
        { name: 'hash-customer', selector: 'tags.customer', method: 'hash' },
        { name: 'cards', selector: '**.card', method: 'replace', replacement: '<card>' },
      ]),
    });
    const { event: scrubbed, removals } = scrubEvent(event, rules, hash);
    expect(scrubbed.user).toEqual({ id: 'u1' });
    expect(scrubbed.exceptions[0]?.value).toBe('*****************');
    expect(scrubbed.tags).toEqual({ customer: 'hash-of-4' });
    expect(scrubbed.extra).toEqual({ order: { card: '<card>', total: 12 } });
    expect(removals).toEqual(
      expect.arrayContaining([
        { path: 'user.email', rule: 'no-email', method: 'remove', originalLength: 15 },
        { path: 'exceptions.0.value', rule: 'mask-values', method: 'mask', originalLength: 17 },
        { path: 'tags.customer', rule: 'hash-customer', method: 'hash', originalLength: 4 },
        { path: 'extra.order.card', rule: 'cards', method: 'replace', originalLength: 4 },
      ]),
    );
    expect(removals).toHaveLength(4);
  });

  it('removes a whole free-form subtree and records the length of its text', () => {
    const rules = scrubbingRules({
      ipAddresses: false,
      project: projectRules([{ name: 'no-order', selector: 'extra.order', method: 'remove' }]),
    });
    const { event: scrubbed, removals } = scrubEvent(event, rules, hash);
    expect(scrubbed.extra).toEqual({});
    expect(removals).toEqual([
      { path: 'extra.order', rule: 'no-order', method: 'remove', originalLength: '{"card":"visa","total":12}'.length },
    ]);
  });

  it('refuses a project rule without a name, with an empty selector, or with an unknown method', () => {
    expect(isRefusal(parseScrubbingRules([{ selector: 'a', method: 'remove' }]))).toBe(true);
    expect(isRefusal(parseScrubbingRules([{ name: 'n', selector: '', method: 'remove' }]))).toBe(true);
    expect(isRefusal(parseScrubbingRules([{ name: 'n', selector: 'a', method: 'shred' }]))).toBe(true);
    expect(isRefusal(parseScrubbingRules('nope'))).toBe(true);
  });
});

// --- property ---

const SENSITIVE_KEYS = ['password', 'db_password', 'clientSecret', 'X-Api-Key', 'authorization', 'Cookie', 'refresh_token', 'credentials'];
const filler = fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd', ' ', '.'), maxLength: 12 });
const secret = fc.string({ unit: fc.constantFrom('Q', 'X', 'Z', '7', '9'), minLength: 10, maxLength: 24 }).map((s) => `SECRET${s}`);

function planted(where: number, key: string, value: string, noise: string): Record<string, unknown> {
  const places: readonly Record<string, unknown>[] = [
    { extra: { [key]: value, other: noise } },
    { extra: { nested: { deeper: [{ [key]: value }] }, other: noise } },
    { request: { url: noise, headers: { [key]: value } } },
    { contexts: { runtime: { [key]: value, name: noise } } },
    { breadcrumbs: [{ message: noise, data: { [key]: value } }] },
    { tags: { [key]: value, note: noise } },
  ];
  return places[where % places.length] ?? {};
}

describe('scrubEvent property', () => {
  it('a secret under a sensitive key appears nowhere in the scrubbed event or its removals, whatever the method', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.constantFrom(...SENSITIVE_KEYS),
        secret,
        filler,
        fc.constantFrom('remove', 'mask', 'hash', 'replace'),
        (where, key, value, noise, method) => {
          const event = normalized({ message: noise, ...planted(where, key, value, noise) });
          const byKey = scrubbingRules({ ipAddresses: false, project: projectRules([{ name: 'p', selector: `**.${key}`, method }]) });
          for (const rules of [defaults, byKey]) {
            expect(JSON.stringify(scrubEvent(event, rules, hash))).not.toContain(value);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
