import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeEvent, type NormalizedEvent } from '../../../../src/domain/normalize/normalize.js';
import { toGroupingInput } from '../../../../src/domain/normalize/grouping-input.js';
import { toEventSummary } from '../../../../src/domain/normalize/event-summary.js';
import type { EventSummary } from '../../../../src/domain/event/event-summary.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import type { GroupingInput } from '../../../../src/domain/grouping/grouping-input.js';

// --- builders ---

const RECEIVED = new Date('2026-11-07T12:00:00Z');

function normalized(raw: Record<string, unknown>): NormalizedEvent {
  const result = normalizeEvent(
    { event_id: 'f'.repeat(32), ...raw },
    { receivedAt: RECEIVED, clampFutureMs: 60_000, retentionMs: 86_400_000, projectId: 'p1', maxTagValueLength: 200 },
  );
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

const chained = normalized({
  platform: 'python',
  level: 'warning',
  logger: 'billing',
  release: 'api@2.0.0',
  environment: 'staging',
  transaction: 'POST /charge',
  tags: { region: 'eu' },
  fingerprint: ['{{ default }}', 'card'],
  logentry: { message: 'charge %s', params: [7], formatted: 'charge 7' },
  exception: {
    values: [
      { type: 'KeyError', value: "'card'", stacktrace: { frames: [{ module: 'app.cards', function: 'lookup', lineno: 9, in_app: true }] } },
      {
        type: 'PaymentError',
        value: 'declined',
        mechanism: { type: 'generic', handled: true, synthetic: false },
        stacktrace: { frames: [{ module: 'app.pay', function: 'charge', lineno: 3, colno: 1, in_app: true, context_line: 'pay()' }] },
      },
    ],
  },
  stacktrace: { frames: [{ filename: 'thread.py', function: 'run' }] },
});

// --- Grouping Input ---

describe('toGroupingInput', () => {
  it('carries the exception chain, stack trace, message and matchable attributes in the order sent', () => {
    const expected: GroupingInput = {
      exceptions: [
        { type: 'KeyError', value: "'card'", frames: [{ module: 'app.cards', function: 'lookup', lineno: 9, inApp: true }] },
        {
          type: 'PaymentError',
          value: 'declined',
          mechanism: { type: 'generic', synthetic: false },
          frames: [{ module: 'app.pay', function: 'charge', lineno: 3, colno: 1, inApp: true, contextLine: 'pay()' }],
        },
      ],
      stacktrace: [{ filename: 'thread.py', function: 'run' }],
      message: { formatted: 'charge 7', template: 'charge %s', params: ['7'] },
      platform: 'python',
      fingerprint: ['{{ default }}', 'card'],
      logger: 'billing',
      level: 'warning',
      tags: { region: 'eu' },
    };
    expect(toGroupingInput(chained)).toEqual(expected);
  });

  it('keeps every frame of every exception, in order', () => {
    const frame = fc.record({ function: fc.string({ maxLength: 8 }), lineno: fc.nat({ max: 999 }) });
    fc.assert(
      fc.property(fc.array(fc.array(frame, { maxLength: 6 }), { maxLength: 4 }), (chain) => {
        const event = normalized({ exception: { values: chain.map((frames) => ({ type: 'E', stacktrace: { frames } })) } });
        expect(toGroupingInput(event).exceptions.map((e) => e.frames)).toEqual(chain);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Event Summary ---

describe('toEventSummary', () => {
  it('summarizes the facts grouping, counting and alerting need, titled by the last exception of the chain', () => {
    const expected: EventSummary = {
      eventId: 'f'.repeat(32),
      at: RECEIVED.getTime(),
      release: 'api@2.0.0',
      environment: 'staging',
      level: 'warning',
      userKey: 'user-key-1',
      title: 'PaymentError: declined',
      culprit: 'POST /charge',
    };
    expect(toEventSummary(chained, 'user-key-1')).toEqual(expected);
  });

  it('titles an event without an exception by its message, and one with neither as unlabeled', () => {
    expect(toEventSummary(normalized({ message: 'disk full' }), null).title).toBe('disk full');
    expect(toEventSummary(normalized({ exception: [{ value: 'only a value' }] }), null).title).toBe('only a value');
    expect(toEventSummary(normalized({ exception: [{ type: 'OnlyType' }] }), null).title).toBe('OnlyType');
    expect(toEventSummary(normalized({}), null).title).toBe('<unlabeled event>');
  });

  it('names the culprit by its transaction, else the innermost in-app frame of the main exception, else none', () => {
    const frames = [
      { module: 'app.cart', function: 'total', in_app: true },
      { filename: 'lib/http.py', function: 'send', in_app: false },
    ];
    expect(toEventSummary(normalized({ exception: [{ type: 'E', stacktrace: { frames } }] }), null).culprit).toBe('app.cart in total');
    expect(toEventSummary(normalized({ stacktrace: { frames: [{ filename: 'lib/http.py', function: 'send' }] } }), null).culprit).toBe(
      'lib/http.py in send',
    );
    expect(toEventSummary(normalized({ message: 'disk full' }), null).culprit).toBeNull();
  });
});
