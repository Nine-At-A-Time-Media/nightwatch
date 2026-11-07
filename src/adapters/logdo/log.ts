/**
 * The arrival log inside LogDO -- an append-only log of Arrival Records in a
 * Durable Object's SQLite storage, with named subscriptions and leases (the
 * local stand-in for K2; architecture A14). Each function takes the object's
 * SqlStorage; the LogDO class only forwards to them, so no step past its
 * input is a method a bound Worker could call by another name.
 *
 * A record's offset is its rowid, which only grows. A subscription remembers
 * the offset it starts after. A delivery row tracks one record for one
 * subscription: which worker holds its lease, until when, and whether it was
 * acked. Every function runs synchronously, so each is atomic in the object.
 */

import type { ArrivalRecord, EndpointKind } from '../../domain/ingest/arrival.js';
import type { LeasedRecord, SubscriptionStart } from '../../domain/ingest/subscription.js';

/** A pull with the caller's clock reading and lease length, so the caller owns time. */
export type PullRequest = { subscription: string; workerId: string; max: number; now: number; leaseMs: number };
export type HeldRequest = { subscription: string; workerId: string; offsets: readonly number[] };
export type ExtendRequest = HeldRequest & { now: number; leaseMs: number };

type Row = Record<string, SqlStorageValue>;

const ENDPOINTS: ReadonlySet<string> = new Set<EndpointKind>(['envelope', 'store', 'security', 'attachment', 'checkin']);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL, project_id TEXT NOT NULL, received_at INTEGER NOT NULL, endpoint TEXT NOT NULL,
     body BLOB, blob_key TEXT, assertion TEXT)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (name TEXT PRIMARY KEY, after_seq INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS deliveries (
     subscription TEXT NOT NULL, seq INTEGER NOT NULL, worker_id TEXT,
     lease_expires_at INTEGER NOT NULL, acked INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (subscription, seq))`,
];

const DELIVERABLE = `
  SELECT r.seq, r.id, r.project_id, r.received_at, r.endpoint, r.body, r.blob_key, r.assertion
  FROM records r
  JOIN subscriptions s ON s.name = ?1
  LEFT JOIN deliveries d ON d.subscription = s.name AND d.seq = r.seq
  WHERE r.seq > s.after_seq AND (d.seq IS NULL OR (d.acked = 0 AND d.lease_expires_at <= ?2))
  ORDER BY r.seq
  LIMIT ?3`;

const LEASE = `
  INSERT INTO deliveries (subscription, seq, worker_id, lease_expires_at, acked) VALUES (?1, ?2, ?3, ?4, 0)
  ON CONFLICT (subscription, seq) DO UPDATE SET worker_id = excluded.worker_id, lease_expires_at = excluded.lease_expires_at`;

/** A log created before records kept their Assertion gains the column; the check makes it safe to repeat. */
const HAS_ASSERTION = `SELECT COUNT(*) AS present FROM pragma_table_info('records') WHERE name = 'assertion'`;
const ADD_ASSERTION = `ALTER TABLE records ADD COLUMN assertion TEXT`;

const HELD = `subscription = ?1 AND seq = ?2 AND worker_id = ?3 AND acked = 0`;

// --- rows ---

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`log row column ${column} is not text`);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number') throw new Error(`log row column ${column} is not a number`);
  return value;
}

function optionalText(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : text(row, column);
}

function endpointOf(row: Row): EndpointKind {
  const value = text(row, 'endpoint');
  if (!ENDPOINTS.has(value)) throw new Error(`log row endpoint ${value} is unknown`);
  return value as EndpointKind;
}

function recordOf(row: Row): ArrivalRecord {
  const base = {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    receivedAt: integer(row, 'received_at'),
    endpoint: endpointOf(row),
    assertion: optionalText(row, 'assertion'),
  };
  const body = row['body'];
  if (body instanceof ArrayBuffer) return { ...base, body: new Uint8Array(body), blobKey: null };
  return { ...base, body: null, blobKey: text(row, 'blob_key') };
}

function blobOf(body: Uint8Array): ArrayBuffer {
  return body.slice().buffer;
}

// --- actions ---

export function ensureLogSchema(sql: SqlStorage): void {
  for (const statement of SCHEMA) sql.exec(statement);
  if (integer(sql.exec(HAS_ASSERTION).one(), 'present') === 0) sql.exec(ADD_ASSERTION);
}

/** Append one Arrival Record; its offset is returned. */
export function appendRecord(sql: SqlStorage, record: ArrivalRecord): { offset: number } {
  const body = record.body === null ? null : blobOf(record.body);
  const row = sql
    .exec(
      'INSERT INTO records (id, project_id, received_at, endpoint, body, blob_key, assertion) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq',
      record.id,
      record.projectId,
      record.receivedAt,
      record.endpoint,
      body,
      record.blobKey,
      record.assertion,
    )
    .one();
  return { offset: integer(row, 'seq') };
}

export function subscribe(sql: SqlStorage, { subscription, start }: { subscription: string; start: SubscriptionStart }): void {
  const after = start === 'earliest' ? 0 : integer(sql.exec('SELECT COALESCE(MAX(seq), 0) AS last FROM records').one(), 'last');
  sql.exec('INSERT OR IGNORE INTO subscriptions (name, after_seq) VALUES (?, ?)', subscription, after);
}

export function pullRecords(sql: SqlStorage, { subscription, workerId, max, now, leaseMs }: PullRequest): LeasedRecord[] {
  const rows = sql.exec(DELIVERABLE, subscription, now, max).toArray();
  for (const row of rows) sql.exec(LEASE, subscription, integer(row, 'seq'), workerId, now + leaseMs);
  return rows.map((row) => ({ offset: integer(row, 'seq'), record: recordOf(row) }));
}

export function ackRecords(sql: SqlStorage, { subscription, workerId, offsets }: HeldRequest): void {
  for (const offset of offsets) sql.exec(`UPDATE deliveries SET acked = 1 WHERE ${HELD}`, subscription, offset, workerId);
}

export function nackRecords(sql: SqlStorage, { subscription, workerId, offsets }: HeldRequest): void {
  for (const offset of offsets) {
    sql.exec(`UPDATE deliveries SET worker_id = NULL, lease_expires_at = 0 WHERE ${HELD}`, subscription, offset, workerId);
  }
}

export function extendLeases(sql: SqlStorage, { subscription, workerId, offsets, now, leaseMs }: ExtendRequest): void {
  for (const offset of offsets) {
    sql.exec(
      `UPDATE deliveries SET lease_expires_at = ?4 WHERE ${HELD} AND lease_expires_at > ?5`,
      subscription,
      offset,
      workerId,
      now + leaseMs,
      now,
    );
  }
}

/** Forgets the subscription and every delivery it tracked; an unknown one is left as it is. */
export function unsubscribe(sql: SqlStorage, { subscription }: { subscription: string }): void {
  sql.exec('DELETE FROM deliveries WHERE subscription = ?', subscription);
  sql.exec('DELETE FROM subscriptions WHERE name = ?', subscription);
}
