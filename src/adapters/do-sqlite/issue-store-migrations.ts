/**
 * The IssueStore's SQLite schema inside ProjectDO, as versioned migrations.
 * `migrateIssueStore` runs on every construction of the object and applies
 * only the migrations past the version the storage records, all in one
 * synchronous transaction, so running it again changes nothing. Migrations
 * ship expand-contract and are never edited once released: a change is a new
 * entry at the end.
 *
 * Values the domain owns are kept as JSON text; the columns beside them are
 * the keys the store's queries select and order by. Every list keeps the
 * order rows were first written in through its `seq` rowid, which an upsert
 * never changes.
 */

const V1 = [
  `CREATE TABLE assignments (event_id TEXT PRIMARY KEY, target TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX assignments_at ON assignments (at)`,
  `CREATE TABLE fingerprints (seq INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL)`,
  `CREATE INDEX fingerprints_issue ON fingerprints (issue_id)`,
  `CREATE TABLE tombstones (seq INTEGER PRIMARY KEY, fingerprints TEXT NOT NULL, tombstone TEXT NOT NULL)`,
  `CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `CREATE TABLE short_ids (issue_id TEXT PRIMARY KEY, short_id INTEGER NOT NULL UNIQUE)`,
  `CREATE TABLE issues (seq INTEGER PRIMARY KEY, issue_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL)`,
  `CREATE TABLE history (seq INTEGER PRIMARY KEY, issue_id TEXT NOT NULL, change TEXT NOT NULL)`,
  `CREATE TABLE events (
     seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL, at INTEGER NOT NULL,
     user_key TEXT, fingerprints TEXT NOT NULL, event TEXT NOT NULL)`,
  `CREATE INDEX events_issue_at ON events (issue_id, at)`,
  `CREATE TABLE forecasts (issue_id TEXT PRIMARY KEY, forecast TEXT NOT NULL)`,
  `CREATE TABLE releases (seq INTEGER PRIMARY KEY, release TEXT NOT NULL UNIQUE, first_seen INTEGER NOT NULL)`,
  `CREATE TABLE reports (
     seq INTEGER PRIMARY KEY, report_id TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL,
     reporter_email TEXT NOT NULL, report TEXT NOT NULL)`,
  `CREATE INDEX reports_issue ON reports (issue_id)`,
  `CREATE INDEX reports_reporter ON reports (reporter_email)`,
  `CREATE TABLE comments (seq INTEGER PRIMARY KEY, issue_id TEXT NOT NULL, report_id TEXT, comment TEXT NOT NULL)`,
  `CREATE INDEX comments_issue ON comments (issue_id)`,
  `CREATE TABLE status_changes (seq INTEGER PRIMARY KEY, report_id TEXT NOT NULL, change TEXT NOT NULL)`,
  `CREATE TABLE session_buckets (
     release TEXT NOT NULL, environment TEXT NOT NULL, status TEXT NOT NULL, minute INTEGER NOT NULL,
     sessions INTEGER NOT NULL, PRIMARY KEY (release, environment, status, minute))`,
  `CREATE TABLE session_users (
     release TEXT NOT NULL, environment TEXT NOT NULL, user_key TEXT NOT NULL, crashed INTEGER NOT NULL,
     PRIMARY KEY (release, environment, user_key))`,
  `CREATE TABLE assignees (issue_id TEXT PRIMARY KEY, assignee TEXT NOT NULL)`,
  `CREATE TABLE firings (
     seq INTEGER PRIMARY KEY, rule_id TEXT NOT NULL, issue_id TEXT NOT NULL, at INTEGER NOT NULL,
     firing TEXT NOT NULL, UNIQUE (rule_id, issue_id, at))`,
  `CREATE TABLE participations (seq INTEGER PRIMARY KEY, issue_id TEXT NOT NULL, participation TEXT NOT NULL)`,
  `CREATE TABLE external_links (issue_id TEXT PRIMARY KEY, link TEXT NOT NULL)`,
];

/** Migration N (1-based) is entry N - 1. */
export const ISSUE_STORE_MIGRATIONS: readonly (readonly string[])[] = [V1];

const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`;
const CURRENT_VERSION = `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`;

// --- helpers ---

/** The migrations after `version`, each with the version it brings the schema to. */
export function pendingMigrations(version: number): { version: number; statements: readonly string[] }[] {
  return ISSUE_STORE_MIGRATIONS.map((statements, index) => ({ version: index + 1, statements })).filter((step) => step.version > version);
}

function currentVersion(sql: SqlStorage): number {
  return Number(sql.exec(CURRENT_VERSION).one()['version']);
}

function applyPending(sql: SqlStorage): void {
  sql.exec(VERSION_TABLE);
  for (const step of pendingMigrations(currentVersion(sql))) {
    for (const statement of step.statements) sql.exec(statement);
    sql.exec('INSERT INTO schema_version (version) VALUES (?)', step.version);
  }
}

// --- action ---

export function migrateIssueStore(storage: DurableObjectStorage): void {
  storage.transactionSync(() => applyPending(storage.sql));
}
