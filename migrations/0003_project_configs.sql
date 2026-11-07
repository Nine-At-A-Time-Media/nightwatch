-- Ingest-side Project config: one JSON entry per Project (Client Keys,
-- allowed origins, size limits, Inbound Filters, Quotas), the document the
-- console also copies to KV for the ingest Worker (architecture, Mechanism:
-- Ingest). D1 is its truth; the local stage's ingest Worker reads it here
-- directly (architecture Seams: Ingest-side project config, D1 direct read).

CREATE TABLE project_configs (
  project_id TEXT PRIMARY KEY REFERENCES projects (project_id),
  config TEXT NOT NULL -- JSON project config entry
);
