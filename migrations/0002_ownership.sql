-- Owner suggestions (task-030): each Project's ownership config, and tracker
-- teams mapped to Teams. Written by the console; read by suggestOwners.

-- A Project's Ownership Rules text, Code Mappings and auto-assign setting,
-- as one JSON value; a Project without a row has none.
CREATE TABLE ownership_configs (
  project_id TEXT PRIMARY KEY REFERENCES projects (project_id),
  config TEXT NOT NULL
);

-- Tracker teams (`org/team`) mapped to Teams; `slug` is kept lower-cased.
CREATE TABLE tracker_teams (
  organization_id TEXT NOT NULL REFERENCES organizations (organization_id),
  slug TEXT NOT NULL,
  team TEXT NOT NULL,
  PRIMARY KEY (organization_id, slug)
);
