/**
 * Retry Advice -- when a sender may send again, per data category (design
 * Domain Language), and its rendering into the SDK's rate-limit header.
 */

export type DataCategory = 'default' | 'error' | 'security' | 'attachment' | 'session' | 'feedback' | 'monitor';
export type QuotaScope = 'organization' | 'project' | 'key';

export type RetryAdviceEntry = {
  readonly retryAfterSeconds: number;
  readonly categories: readonly DataCategory[];
  readonly scope: QuotaScope;
  readonly reason: string | null;
};

export type RetryAdvice = readonly RetryAdviceEntry[];

function renderEntry(entry: RetryAdviceEntry): string {
  const fields = [String(entry.retryAfterSeconds), entry.categories.join(';'), entry.scope];
  if (entry.reason) fields.push(entry.reason);
  return fields.join(':');
}

export function rateLimitHeader(advice: RetryAdvice): string {
  return advice.map(renderEntry).join(', ');
}

export function retryAfterSeconds(advice: RetryAdvice): number {
  return advice.reduce((longest, entry) => Math.max(longest, entry.retryAfterSeconds), 0);
}
