/**
 * The Quota counters inside QuotaDO -- one object per Project, one fixed-window
 * counter per data category, in the object's SQLite storage. Each function
 * takes the object's SqlStorage; the QuotaDO class only forwards to them.
 * A consume runs synchronously, so it is atomic in the object: a check that
 * fits adds its quantity, one that does not adds nothing.
 */

import type { DataCategory } from '../../domain/protocol/retry-advice.js';

/** One consume, with the caller's clock reading so the caller owns time. */
export type ConsumeRequest = { category: DataCategory; quantity: number; limit: number; windowMs: number; now: number };

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const SCHEMA = `CREATE TABLE IF NOT EXISTS counters (
  category TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY (category, window_start))`;

// --- helpers ---

function windowStartOf({ now, windowMs }: { now: number; windowMs: number }): number {
  return now - (now % windowMs);
}

/** Whole seconds until the window ends, never zero. */
function secondsLeft({ now, windowEnd }: { now: number; windowEnd: number }): number {
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
}

// --- actions ---

export function ensureQuotaSchema(sql: SqlStorage): void {
  sql.exec(SCHEMA);
}

export function consumeQuota(sql: SqlStorage, { category, quantity, limit, windowMs, now }: ConsumeRequest): ConsumeResult {
  const windowStart = windowStartOf({ now, windowMs });
  sql.exec('DELETE FROM counters WHERE category = ? AND window_start < ?', category, windowStart);
  const rows = sql.exec('SELECT used FROM counters WHERE category = ? AND window_start = ?', category, windowStart).toArray();
  const used = Number(rows[0]?.['used'] ?? 0);
  if (used + quantity > limit) return { allowed: false, retryAfterSeconds: secondsLeft({ now, windowEnd: windowStart + windowMs }) };
  sql.exec(
    `INSERT INTO counters (category, window_start, used) VALUES (?1, ?2, ?3)
     ON CONFLICT (category, window_start) DO UPDATE SET used = used + ?3`,
    category,
    windowStart,
    quantity,
  );
  return { allowed: true };
}
