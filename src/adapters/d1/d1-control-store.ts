/**
 * D1ControlStore -- the ControlStore over a D1 database whose schema is
 * `migrations/` at the repository root. Rows come back in the order they were
 * written (rowid). Rule bodies, processing config and notification settings
 * are JSON columns the console writes whole; a column that is not JSON is an
 * operator error and fails loudly, never reading as missing. A write that
 * reports Durability and throws is reported as retryable, since D1 errors at
 * this boundary are transient (the schema itself is checked at deploy).
 *
 * The Artifact index is kept per Organization; artifactsFor reaches it
 * through the Project's Organization, so processing finds exactly what
 * uploadArtifact indexed.
 */

import { z } from 'zod';
import type { EmailRecipient, IssueAlertRule } from '../../domain/alerts/issue-alert-rule.js';
import type { NotificationSettings } from '../../domain/alerts/notification-settings.js';
import type { Durability } from '../../domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../../domain/ids.js';
import type { Member } from '../../domain/issue/state.js';
import type { ProcessingConfig } from '../../domain/processing/processing.js';
import type { TrustedIssuer } from '../../domain/signin/sign-in.js';
import { normalizedDebugId, type Artifact, type ArtifactQuery } from '../../domain/sourcemap/artifact.js';
import { SCOPES, type AccessTokenRecord } from '../../domain/tenancy/access-token.js';
import type { Repository } from '../../domain/tracker/external-link.js';
import type { ControlStore, LinkEntry, Membership, ReferenceEntry } from '../../ports/control-store.js';

const Audiences = z.array(z.string());
const Scopes = z.array(z.enum(SCOPES));
const NO_SETTINGS: NotificationSettings = { organization: {}, projects: {} };

type MemberRow = { member_id: string };
type ReferenceRow = { organization_id: string; project_id: string; report_id: string };
type AccessTokenRow = { organization_id: string; scopes: string; expires_at: number | null; revoked: number };
type ArtifactRow = { artifact_id: string; debug_id: string | null; release: string | null; file_name: string };
type LinkEntryRow = { repository: string; number: number; project_id: string; issue_id: string };

const ARTIFACT_COLUMNS = 'a.artifact_id, a.debug_id, a.release, a.file_name';
const LINK_ENTRY_COLUMNS = 'repository, number, project_id, issue_id';

// --- helpers ---

function parseJson<T>({ text, what }: { text: string; what: string }): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`control store: ${what} is not JSON`);
  }
}

function parsed<T>(schema: z.ZodType<T>, { text, what }: { text: string; what: string }): T {
  const result = schema.safeParse(parseJson<unknown>({ text, what }));
  if (!result.success) throw new Error(`control store: ${what} is malformed: ${result.error.message}`);
  return result.data;
}

function memberOf(row: MemberRow): Member {
  return { member: row.member_id };
}

function artifactOf(row: ArtifactRow): Artifact {
  return { id: row.artifact_id, debugId: row.debug_id, release: row.release, fileName: row.file_name };
}

function linkEntryOf(row: LinkEntryRow): LinkEntry {
  return { repository: row.repository, number: row.number, projectId: row.project_id, issueId: row.issue_id };
}

function accessTokenOf(row: AccessTokenRow, hash: string): AccessTokenRecord {
  return {
    organizationId: row.organization_id,
    scopes: parsed(Scopes, { text: row.scopes, what: `scopes of token ${hash}` }),
    expiresAt: row.expires_at,
    revoked: row.revoked === 1,
  };
}

function recipientsQuery(recipient: { projectId: ProjectId; to: EmailRecipient }): { sql: string; values: unknown[] } {
  const { projectId, to } = recipient;
  if (to.kind === 'owners') {
    return { sql: 'SELECT member_id FROM project_members WHERE project_id = ? AND owner = 1 ORDER BY rowid', values: [projectId] };
  }
  if (to.kind === 'member') {
    return { sql: 'SELECT member_id FROM project_members WHERE project_id = ? AND member_id = ?', values: [projectId, to.member] };
  }
  return {
    sql: `SELECT t.member_id FROM team_members t JOIN projects p ON p.organization_id = t.organization_id
          WHERE p.project_id = ? AND t.team = ? ORDER BY t.rowid`,
    values: [projectId, to.team],
  };
}

// --- exports ---

export class D1ControlStore implements ControlStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  // --- Organizations, Projects and sign-in ---

  async organizations(): Promise<readonly OrganizationId[]> {
    return this.#column<string>('SELECT organization_id AS value FROM organizations ORDER BY rowid');
  }

  async organizationOf(projectId: ProjectId): Promise<OrganizationId | null> {
    return this.#value<string>('SELECT organization_id AS value FROM projects WHERE project_id = ?', projectId);
  }

  async projectsOf(organizationId: OrganizationId): Promise<readonly ProjectId[]> {
    return this.#column<string>('SELECT project_id AS value FROM projects WHERE organization_id = ? ORDER BY rowid', organizationId);
  }

  async trustedIssuers(organizationId: OrganizationId): Promise<readonly TrustedIssuer[]> {
    const rows = await this.#all<{ issuer: string; audiences: string }>(
      'SELECT issuer, audiences FROM trusted_issuers WHERE organization_id = ? ORDER BY rowid',
      organizationId,
    );
    return rows.map((row) => ({
      issuer: row.issuer,
      audiences: parsed(Audiences, { text: row.audiences, what: `audiences of ${row.issuer}` }),
    }));
  }

  // --- Membership ---

  async isProjectMember(membership: { projectId: ProjectId; email: string }): Promise<boolean> {
    const found = await this.#value<number>(
      `SELECT 1 AS value FROM project_members pm JOIN members m ON m.member_id = pm.member_id
       WHERE pm.project_id = ? AND lower(m.email) = lower(?) LIMIT 1`,
      membership.projectId,
      membership.email,
    );
    return found !== null;
  }

  async membershipOf(member: Member): Promise<Membership | null> {
    const row = await this.#first<{ organization_id: string; role: Membership['role'] }>(
      'SELECT organization_id, role FROM memberships WHERE member_id = ?',
      member.member,
    );
    return row === null ? null : { organizationId: row.organization_id, role: row.role };
  }

  // --- Report Reference index ---

  async putReference(hash: string, entry: ReferenceEntry): Promise<Durability> {
    return this.#write('put-reference', [
      this.#statement(
        'INSERT OR REPLACE INTO report_references (hash, organization_id, project_id, report_id) VALUES (?, ?, ?, ?)',
        hash,
        entry.organizationId,
        entry.projectId,
        entry.reportId,
      ),
    ]);
  }

  async findReference(hash: string): Promise<ReferenceEntry | null> {
    const row = await this.#first<ReferenceRow>(
      'SELECT organization_id, project_id, report_id FROM report_references WHERE hash = ?',
      hash,
    );
    return row === null ? null : { organizationId: row.organization_id, projectId: row.project_id, reportId: row.report_id };
  }

  // --- reporter subscriptions ---

  async isUnsubscribed(reportId: ReportId): Promise<boolean> {
    return (await this.#value<number>('SELECT 1 AS value FROM unsubscribed_reports WHERE report_id = ?', reportId)) !== null;
  }

  async unsubscribe(reportId: ReportId): Promise<void> {
    await this.#statement('INSERT OR IGNORE INTO unsubscribed_reports (report_id) VALUES (?)', reportId).run();
  }

  async forgetReport(reportId: ReportId): Promise<Durability> {
    return this.#write('forget-report', [
      this.#statement('DELETE FROM report_references WHERE report_id = ?', reportId),
      this.#statement('DELETE FROM unsubscribed_reports WHERE report_id = ?', reportId),
    ]);
  }

  // --- Access Tokens, kept only as hashes ---

  async putAccessToken(hash: string, record: AccessTokenRecord): Promise<Durability> {
    return this.#write('put-access-token', [
      this.#statement(
        'INSERT OR REPLACE INTO access_tokens (hash, organization_id, scopes, expires_at, revoked) VALUES (?, ?, ?, ?, ?)',
        hash,
        record.organizationId,
        JSON.stringify(record.scopes),
        record.expiresAt,
        record.revoked ? 1 : 0,
      ),
    ]);
  }

  async findAccessToken(hash: string): Promise<AccessTokenRecord | null> {
    const row = await this.#first<AccessTokenRow>(
      'SELECT organization_id, scopes, expires_at, revoked FROM access_tokens WHERE hash = ?',
      hash,
    );
    return row === null ? null : accessTokenOf(row, hash);
  }

  // --- the Artifact index ---

  async putArtifact(organizationId: OrganizationId, artifact: Artifact): Promise<Durability> {
    return this.#write('put-artifact', [
      this.#statement(
        `INSERT OR IGNORE INTO artifacts (organization_id, artifact_id, debug_id, debug_id_key, release, file_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        organizationId,
        artifact.id,
        artifact.debugId,
        artifact.debugId === null ? null : normalizedDebugId(artifact.debugId),
        artifact.release,
        artifact.fileName,
      ),
    ]);
  }

  // --- alert rules, recipients and notification settings ---

  async issueAlertRules(projectId: ProjectId): Promise<readonly IssueAlertRule[]> {
    const rows = await this.#all<{ rule_id: string; rule: string }>(
      'SELECT rule_id, rule FROM issue_alert_rules WHERE project_id = ? ORDER BY rowid',
      projectId,
    );
    return rows.map((row) => parseJson<IssueAlertRule>({ text: row.rule, what: `alert rule ${row.rule_id}` }));
  }

  async recipientsOf(recipient: { projectId: ProjectId; to: EmailRecipient }): Promise<readonly Member[]> {
    const { sql, values } = recipientsQuery(recipient);
    return (await this.#all<MemberRow>(sql, ...values)).map(memberOf);
  }

  async addressOf(member: Member): Promise<string | null> {
    return this.#value<string>('SELECT email AS value FROM members WHERE member_id = ?', member.member);
  }

  async projectMembers(projectId: ProjectId): Promise<readonly Member[]> {
    return (await this.#all<MemberRow>('SELECT member_id FROM project_members WHERE project_id = ? ORDER BY rowid', projectId)).map(
      memberOf,
    );
  }

  async notificationSettingsOf(member: Member): Promise<NotificationSettings> {
    const text = await this.#value<string>('SELECT settings AS value FROM notification_settings WHERE member_id = ?', member.member);
    return text === null ? NO_SETTINGS : parseJson<NotificationSettings>({ text, what: `notification settings of ${member.member}` });
  }

  // --- processing config and the Artifact index read ---

  async processingConfig(projectId: ProjectId): Promise<ProcessingConfig | null> {
    const text = await this.#value<string>('SELECT config AS value FROM processing_configs WHERE project_id = ?', projectId);
    return text === null ? null : parseJson<ProcessingConfig>({ text, what: `processing config of ${projectId}` });
  }

  async artifactsFor(projectId: ProjectId, query: ArtifactQuery): Promise<readonly Artifact[]> {
    const rows = await this.#all<ArtifactRow>(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts a JOIN projects p ON p.organization_id = a.organization_id
       WHERE p.project_id = ?
         AND ((? IS NOT NULL AND a.release = ?) OR a.debug_id_key IN (SELECT value FROM json_each(?)))
       ORDER BY a.rowid`,
      projectId,
      query.release,
      query.release,
      JSON.stringify(query.debugIds.map(normalizedDebugId)),
    );
    return rows.map(artifactOf);
  }

  // --- Code and GitHub ---

  async isRepositoryConnected(connection: { organizationId: OrganizationId; repository: Repository }): Promise<boolean> {
    return (await this.organizationOfRepository(connection.repository)) === connection.organizationId;
  }

  async organizationOfRepository(repository: Repository): Promise<OrganizationId | null> {
    return this.#value<string>('SELECT organization_id AS value FROM repositories WHERE repository = ?', repository);
  }

  async disconnectRepositories(repositories: readonly Repository[]): Promise<void> {
    await this.#statement(
      'DELETE FROM repositories WHERE repository IN (SELECT value FROM json_each(?))',
      JSON.stringify(repositories),
    ).run();
  }

  async putLinkEntry(entry: LinkEntry): Promise<void> {
    await this.#statement(
      `INSERT INTO link_entries (repository, number, project_id, issue_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (repository, number) DO UPDATE SET project_id = excluded.project_id, issue_id = excluded.issue_id`,
      entry.repository,
      entry.number,
      entry.projectId,
      entry.issueId,
    ).run();
  }

  async findLinkEntry(issue: { repository: Repository; number: number }): Promise<LinkEntry | null> {
    const row = await this.#first<LinkEntryRow>(
      `SELECT ${LINK_ENTRY_COLUMNS} FROM link_entries WHERE repository = ? AND number = ?`,
      issue.repository,
      issue.number,
    );
    return row === null ? null : linkEntryOf(row);
  }

  async linkEntriesIn(repositories: readonly Repository[]): Promise<readonly LinkEntry[]> {
    const rows = await this.#all<LinkEntryRow>(
      `SELECT ${LINK_ENTRY_COLUMNS} FROM link_entries WHERE repository IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
      JSON.stringify(repositories),
    );
    return rows.map(linkEntryOf);
  }

  async memberOfTrackerAccount(account: { organizationId: OrganizationId; login: string }): Promise<Member | null> {
    const row = await this.#first<MemberRow>(
      'SELECT member_id FROM tracker_accounts WHERE organization_id = ? AND login = lower(?)',
      account.organizationId,
      account.login,
    );
    return row === null ? null : memberOf(row);
  }

  async projectOfSlug(slug: { organizationId: OrganizationId; slug: string }): Promise<ProjectId | null> {
    return this.#value<string>(
      'SELECT project_id AS value FROM projects WHERE organization_id = ? AND upper(slug) = upper(?)',
      slug.organizationId,
      slug.slug,
    );
  }

  // --- statements ---

  #statement(sql: string, ...values: unknown[]): D1PreparedStatement {
    return this.#db.prepare(sql).bind(...values);
  }

  async #first<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    return this.#statement(sql, ...values).first<T>();
  }

  async #all<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    return (await this.#statement(sql, ...values).all<T>()).results;
  }

  async #value<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    return (await this.#first<{ value: T }>(sql, ...values))?.value ?? null;
  }

  async #column<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    return (await this.#all<{ value: T }>(sql, ...values)).map((row) => row.value);
  }

  /** Runs the statements as one batch: all of them land, or none and the write is retryable. */
  async #write(what: string, statements: D1PreparedStatement[]): Promise<Durability> {
    try {
      await this.#db.batch(statements);
      return { ok: true };
    } catch (error) {
      console.error(JSON.stringify({ event: `control-store.${what}-failed`, error: String(error) }));
      return { ok: false, retryable: true };
    }
  }
}
