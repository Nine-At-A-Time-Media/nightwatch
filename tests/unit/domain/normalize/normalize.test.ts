import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeEvent, type NormalizeContext, type NormalizedEvent } from '../../../../src/domain/normalize/normalize.js';
import { isRefusal, type Refusal } from '../../../../src/domain/refusal.js';

// --- builders ---

const RECEIVED = new Date('2026-11-07T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ID = 'a'.repeat(32);

function context(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    receivedAt: RECEIVED,
    clampFutureMs: HOUR,
    retentionMs: 90 * DAY,
    projectId: 'p1',
    maxTagValueLength: 200,
    ...overrides,
  };
}

function normalized(raw: unknown, overrides: Partial<NormalizeContext> = {}): NormalizedEvent {
  const result = normalizeEvent(raw, context(overrides));
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

function refused(result: NormalizedEvent | Refusal): string {
  return isRefusal(result) ? result.refusal : 'accepted';
}

const browserCrash = {
  event_id: ID,
  timestamp: RECEIVED.getTime() / 1000 - 1.5,
  level: 'fatal',
  platform: 'javascript',
  logentry: { message: 'Charge %s failed', params: ['card'], formatted: 'Charge card failed' },
  exception: {
    values: [
      {
        type: 'TypeError',
        value: 'x is undefined',
        mechanism: { type: 'onerror', handled: false },
        stacktrace: {
          frames: [
            { filename: 'vendor.js', abs_path: 'https://cdn.example/vendor.js', function: 'run', lineno: 1, colno: 99, in_app: false },
            { filename: 'app.js', abs_path: 'https://cdn.example/app.js', function: 'a', lineno: 1, colno: 1234, in_app: true },
          ],
        },
      },
    ],
  },
  release: 'web@1.2.0',
  environment: 'production',
  user: { id: 42, email: 'ada@example.com', ip_address: '203.0.113.9', username: 'ada' },
  tags: { browser: 'Firefox', build: 7 },
  contexts: { os: { name: 'Linux' } },
  request: { url: 'https://shop.example/cart', method: 'POST', headers: [['Content-Type', 'text/plain']] },
  sdk: { name: 'sentry.javascript.browser', version: '8.0.0' },
  fingerprint: ['{{ default }}', 'checkout'],
  breadcrumbs: { values: [{ timestamp: RECEIVED.getTime() / 1000 - 10, category: 'ui.click', message: 'button#pay' }] },
  extra: { cart: { items: 3 } },
  server_name: 'edge-1',
  transaction: '/cart',
  logger: 'console',
  debug_meta: {
    images: [{ type: 'sourcemap', code_file: 'https://cdn.example/app.js', debug_id: 'c0ffee00-0000-4000-8000-000000000001' }],
  },
};

// --- normalization ---

describe('normalizeEvent', () => {
  it('reads every part of an SDK event, frames oldest first as sent', () => {
    const event = normalized(browserCrash);
    expect(event.eventId).toBe(ID);
    expect(event.projectId).toBe('p1');
    expect(event.timestamp).toBe(RECEIVED.getTime() - 1500);
    expect(event.receivedAt).toBe(RECEIVED.getTime());
    expect(event.level).toBe('fatal');
    expect(event.platform).toBe('javascript');
    expect(event.message).toEqual({ formatted: 'Charge card failed', template: 'Charge %s failed', params: ['card'] });
    expect(event.exceptions).toEqual([
      {
        type: 'TypeError',
        value: 'x is undefined',
        mechanism: { type: 'onerror', handled: false },
        frames: [
          { filename: 'vendor.js', absPath: 'https://cdn.example/vendor.js', function: 'run', lineno: 1, colno: 99, inApp: false },
          { filename: 'app.js', absPath: 'https://cdn.example/app.js', function: 'a', lineno: 1, colno: 1234, inApp: true },
        ],
      },
    ]);
    expect(event.release).toBe('web@1.2.0');
    expect(event.environment).toBe('production');
    expect(event.user).toEqual({ id: '42', email: 'ada@example.com', ipAddress: '203.0.113.9', username: 'ada' });
    expect(event.tags).toEqual({ browser: 'Firefox', build: '7' });
    expect(event.contexts).toEqual({ os: { name: 'Linux' } });
    expect(event.request).toEqual({ url: 'https://shop.example/cart', method: 'POST', headers: { 'Content-Type': 'text/plain' } });
    expect(event.sdk).toEqual({ name: 'sentry.javascript.browser', version: '8.0.0' });
    expect(event.fingerprint).toEqual(['{{ default }}', 'checkout']);
    expect(event.breadcrumbs).toEqual([{ timestamp: RECEIVED.getTime() - 10_000, category: 'ui.click', message: 'button#pay' }]);
    expect(event.extra).toEqual({ cart: { items: 3 } });
    expect(event.serverName).toBe('edge-1');
    expect(event.transaction).toBe('/cart');
    expect(event.logger).toBe('console');
    expect(event.debugImages).toEqual([
      { type: 'sourcemap', codeFile: 'https://cdn.example/app.js', debugId: 'c0ffee00-0000-4000-8000-000000000001' },
    ]);
    expect(event.errors).toEqual([]);
  });

  it('accepts a plain message, a bare exception list, a top-level stack trace, tags as pairs and an ISO timestamp', () => {
    const event = normalized({
      event_id: ID,
      timestamp: '2026-11-07T11:59:00Z',
      message: 'disk full',
      exception: [{ type: 'IOError', value: 'disk full' }],
      stacktrace: { frames: [{ module: 'app.disk', function: 'write', lineno: 3, context_line: 'f.write(b)' }] },
      tags: [
        ['region', 'eu'],
        ['tier', 'free'],
      ],
    });
    expect(event.timestamp).toBe(Date.parse('2026-11-07T11:59:00Z'));
    expect(event.message).toEqual({ formatted: 'disk full', template: null, params: [] });
    expect(event.exceptions).toEqual([{ type: 'IOError', value: 'disk full', frames: [] }]);
    expect(event.stacktrace).toEqual([{ module: 'app.disk', function: 'write', lineno: 3, contextLine: 'f.write(b)' }]);
    expect(event.tags).toEqual({ region: 'eu', tier: 'free' });
  });

  it('fills defaults for absent parts', () => {
    const event = normalized({ event_id: ID });
    expect(event).toMatchObject({
      timestamp: RECEIVED.getTime(),
      level: 'error',
      platform: 'other',
      message: null,
      exceptions: [],
      stacktrace: null,
      release: null,
      environment: null,
      user: null,
      tags: {},
      contexts: {},
      request: null,
      sdk: null,
      fingerprint: null,
      breadcrumbs: [],
      extra: {},
      serverName: null,
      transaction: null,
      logger: null,
      debugImages: [],
      errors: [],
    });
  });

  it('drops invalid parts and records each removal by its path, never crashing', () => {
    const event = normalized({
      event_id: ID,
      level: 'loud',
      user: 'ada',
      release: 12,
      fingerprint: [{ nested: true }],
      exception: { values: [{ type: 'E', stacktrace: { frames: [{ function: 'f', lineno: 'seven', in_app: 'yes' }, 'junk'] } }] },
      tags: { ok: 'yes', list: ['a'] },
      breadcrumbs: [{ message: 'fine' }, 7],
    });
    expect(event.level).toBe('error');
    expect(event.user).toBeNull();
    expect(event.release).toBeNull();
    expect(event.fingerprint).toBeNull();
    expect(event.exceptions).toEqual([{ type: 'E', value: null, frames: [{ function: 'f' }] }]);
    expect(event.tags).toEqual({ ok: 'yes' });
    expect(event.breadcrumbs).toEqual([{ timestamp: null, message: 'fine' }]);
    expect(event.errors.map((e) => e.path).sort()).toEqual(
      [
        'breadcrumbs.1',
        'exception.values.0.stacktrace.frames.0.in_app',
        'exception.values.0.stacktrace.frames.0.lineno',
        'exception.values.0.stacktrace.frames.1',
        'fingerprint',
        'level',
        'release',
        'tags.list',
        'user',
      ].sort(),
    );
    event.errors.forEach((e) => expect(e.reason).toBe('invalid'));
  });

  it('drops a tag whose value is over the bound and records it as too long', () => {
    const event = normalized({ event_id: ID, tags: { short: 'abc', long: 'x'.repeat(11) } }, { maxTagValueLength: 10 });
    expect(event.tags).toEqual({ short: 'abc' });
    expect(event.errors).toEqual([{ path: 'tags.long', reason: 'too-long' }]);
  });

  it('takes the event id from the context when the event carries none, and normalizes a dashed id', () => {
    expect(normalized({}, { eventId: 'B'.repeat(32) }).eventId).toBe('b'.repeat(32));
    expect(normalized({ event_id: 'c0ffee00-0000-4000-8000-000000000001' }).eventId).toBe('c0ffee00000040008000000000000001');
  });

  it('refuses an event that is not an object or that has no usable event id', () => {
    expect(refused(normalizeEvent('nope', context()))).toBe('malformed-event');
    expect(refused(normalizeEvent([], context()))).toBe('malformed-event');
    expect(refused(normalizeEvent({}, context()))).toBe('missing-event-id');
    expect(refused(normalizeEvent({ event_id: 'xyz' }, context()))).toBe('missing-event-id');
  });

  it('never throws on arbitrary input, and an object with an id always normalizes', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        const result = normalizeEvent(raw, context({ eventId: ID }));
        const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
        expect(isRefusal(result)).toBe(!isObject);
      }),
      { numRuns: 200 },
    );
  });
});

// --- clock drift ---

describe('normalizeEvent clock drift', () => {
  it('shifts event and breadcrumb times by the difference between receipt and the sender clock', () => {
    const sentAt = new Date(RECEIVED.getTime() - 5 * 60_000);
    const event = normalized(
      {
        event_id: ID,
        timestamp: sentAt.getTime() / 1000 - 2,
        breadcrumbs: [{ timestamp: sentAt.getTime() / 1000 - 30 }],
      },
      { sentAt },
    );
    expect(event.timestamp).toBe(RECEIVED.getTime() - 2000);
    expect(event.breadcrumbs[0]?.timestamp).toBe(RECEIVED.getTime() - 30_000);
  });

  it('clamps a time too far in the future to receipt and records it', () => {
    const event = normalized({ event_id: ID, timestamp: (RECEIVED.getTime() + 2 * HOUR) / 1000 });
    expect(event.timestamp).toBe(RECEIVED.getTime());
    expect(event.errors).toEqual([{ path: 'timestamp', reason: 'clamped' }]);
    expect(normalized({ event_id: ID, timestamp: (RECEIVED.getTime() + HOUR / 2) / 1000 }).timestamp).toBe(RECEIVED.getTime() + HOUR / 2);
  });

  it('refuses an event older than the Event Retention window', () => {
    const old = (RECEIVED.getTime() - 91 * DAY) / 1000;
    expect(refused(normalizeEvent({ event_id: ID, timestamp: old }, context()))).toBe('event-too-old');
    expect(refused(normalizeEvent({ event_id: ID, timestamp: (RECEIVED.getTime() - 89 * DAY) / 1000 }, context()))).toBe('accepted');
  });

  it('never yields a time beyond the clamp, whatever the sender clock says', () => {
    fc.assert(
      fc.property(fc.integer({ min: -30 * DAY, max: 30 * DAY }), fc.integer({ min: -DAY, max: DAY }), (offset, skew) => {
        const result = normalizeEvent(
          { event_id: ID, timestamp: (RECEIVED.getTime() + offset) / 1000 },
          context({ sentAt: new Date(RECEIVED.getTime() + skew) }),
        );
        if (isRefusal(result)) throw new Error(result.refusal);
        expect(result.timestamp).toBeLessThanOrEqual(RECEIVED.getTime() + HOUR);
      }),
    );
  });
});
