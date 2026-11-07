import { describe, expect, it } from 'vitest';
import { rateLimitHeader, retryAfterSeconds } from '../../../../src/domain/protocol/retry-advice.js';

describe('Retry Advice rendering', () => {
  it('renders one entry per refusal with its categories, scope and reason', () => {
    const advice = [
      { retryAfterSeconds: 60, categories: ['error', 'default'] as const, scope: 'project' as const, reason: 'quota_exceeded' },
      { retryAfterSeconds: 10, categories: [] as const, scope: 'key' as const, reason: null },
    ];
    expect(rateLimitHeader(advice)).toBe('60:error;default:project:quota_exceeded, 10::key');
  });

  it('tells the sender to wait for the longest entry', () => {
    expect(
      retryAfterSeconds([
        { retryAfterSeconds: 5, categories: [], scope: 'key', reason: null },
        { retryAfterSeconds: 30, categories: ['attachment'], scope: 'project', reason: null },
      ]),
    ).toBe(30);
    expect(retryAfterSeconds([])).toBe(0);
  });
});
