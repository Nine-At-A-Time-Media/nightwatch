-- Control plane: the D1 schema behind ControlStore (architecture Seams,
-- Control-plane records). Rows are read back in the order they were written
-- (rowid). JSON columns hold domain values the console writes whole.
-- Tables written by use cases (references, subscriptions, tokens, artifacts,
-- link entries) carry no foreign keys, so such a write never fails on a row
-- the console has not written yet.

CREATE TABLE organizations (
  organization_id TEXT PRIMARY KEY
);

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  -- The slug the Project's Short Ids carry; matched without case.
  slug TEXT
);
CREATE INDEX projects_by_organization ON projects (organization_id);
CREATE UNIQUE INDEX projects_by_slug ON projects (organization_id, upper(slug)) WHERE slug IS NOT NULL;

CREATE TABLE trusted_issuers (
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  issuer TEXT NOT NULL,
  audiences TEXT NOT NULL, -- JSON array of strings
  PRIMARY KEY (organization_id, issuer)
);

-- Members and where they belong.

CREATE TABLE members (
  member_id TEXT PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE INDEX members_by_email ON members (lower(email));

CREATE TABLE memberships (
  member_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member'))
);

-- Members with permission on a Project; `owner` marks its owners.
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects (project_id),
  member_id TEXT NOT NULL REFERENCES members (member_id),
  owner INTEGER NOT NULL DEFAULT 0 CHECK (owner IN (0, 1)),
  PRIMARY KEY (project_id, member_id)
);

CREATE TABLE team_members (
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  team TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members (member_id),
  PRIMARY KEY (organization_id, team, member_id)
);

CREATE TABLE notification_settings (
  member_id TEXT PRIMARY KEY REFERENCES members (member_id),
  settings TEXT NOT NULL -- JSON NotificationSettings
);

-- Per-Project configuration.

CREATE TABLE processing_configs (
  project_id TEXT PRIMARY KEY REFERENCES projects (project_id),
  config TEXT NOT NULL -- JSON ProcessingConfig
);

CREATE TABLE issue_alert_rules (
  project_id TEXT NOT NULL REFERENCES projects (project_id),
  rule_id TEXT NOT NULL,
  rule TEXT NOT NULL, -- JSON IssueAlertRule
  PRIMARY KEY (project_id, rule_id)
);

-- Report Reference index: only the hash of each reference.

CREATE TABLE report_references (
  hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  report_id TEXT NOT NULL
);
CREATE INDEX report_references_by_report ON report_references (report_id);

CREATE TABLE unsubscribed_reports (
  report_id TEXT PRIMARY KEY
);

-- Access Tokens: only the hash of each token.

CREATE TABLE access_tokens (
  hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  scopes TEXT NOT NULL, -- JSON array of Scopes
  expires_at INTEGER, -- epoch ms; null never expires
  revoked INTEGER NOT NULL CHECK (revoked IN (0, 1))
);

-- The Artifact index, per Organization. `debug_id_key` is the debug id in
-- normalizedDebugId form, the form lookups compare.

CREATE TABLE artifacts (
  organization_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  debug_id TEXT,
  debug_id_key TEXT,
  release TEXT,
  file_name TEXT NOT NULL
);
CREATE UNIQUE INDEX artifacts_identity ON artifacts (organization_id, artifact_id, ifnull(debug_id, ''), ifnull(release, ''), file_name);
CREATE INDEX artifacts_by_release ON artifacts (organization_id, release);
CREATE INDEX artifacts_by_debug_id ON artifacts (organization_id, debug_id_key);

-- Code and GitHub.

CREATE TABLE repositories (
  repository TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id)
);

CREATE TABLE link_entries (
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  PRIMARY KEY (repository, number)
);

-- Tracker accounts mapped to Members; `login` is kept lower-cased.
CREATE TABLE tracker_accounts (
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  login TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (organization_id, login)
);
