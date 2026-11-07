// Bindings the integration project adds beside the ingest Worker's own
// (vitest.config.ts): the control-plane D1 database and its migrations.
declare namespace Cloudflare {
  interface Env {
    CONTROL: D1Database;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
