// Control-plane seeding for the Worker integration projects: the rows the
// console writes and no use case does, written as raw SQL into the local D1
// `CONTROL` database. Ids are unique per test, since one database serves a
// whole file.
import type { IssueAlertRule } from '../../src/domain/alerts/issue-alert-rule.js';

/** One Organization with one Project and one Member who owns it. */
export type SeededProject = {
  readonly organizationId: string;
  readonly projectId: string;
  readonly member: string;
  readonly email: string;
};

async function run(db: D1Database, sql: string, ...values: unknown[]): Promise<void> {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

/** Seeds a fresh Organization, Project and owning Member. */
export async function seedProject(db: D1Database): Promise<SeededProject> {
  const suffix = crypto.randomUUID();
  const seeded = {
    organizationId: `org-${suffix}`,
    projectId: `project-${suffix}`,
    member: `member-${suffix}`,
    email: `ada-${suffix}@example.test`,
  };
  await run(db, 'INSERT INTO organizations (organization_id) VALUES (?)', seeded.organizationId);
  await run(db, 'INSERT INTO projects (project_id, organization_id) VALUES (?, ?)', seeded.projectId, seeded.organizationId);
  await run(db, 'INSERT INTO members (member_id, email) VALUES (?, ?)', seeded.member, seeded.email);
  await run(db, "INSERT INTO memberships (member_id, organization_id, role) VALUES (?, ?, 'owner')", seeded.member, seeded.organizationId);
  await run(db, 'INSERT INTO project_members (project_id, member_id, owner) VALUES (?, ?, 1)', seeded.projectId, seeded.member);
  return seeded;
}

export async function seedAlertRule(db: D1Database, projectId: string, rule: IssueAlertRule): Promise<void> {
  await run(db, 'INSERT INTO issue_alert_rules (project_id, rule_id, rule) VALUES (?, ?, ?)', projectId, rule.ruleId, JSON.stringify(rule));
}

export async function seedRepository(db: D1Database, organizationId: string, repository: string): Promise<void> {
  await run(db, 'INSERT INTO repositories (repository, organization_id) VALUES (?, ?)', repository, organizationId);
}
