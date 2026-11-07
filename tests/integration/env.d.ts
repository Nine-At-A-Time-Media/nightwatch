// Bindings the integration projects add beside each Worker's own
// (vitest.config.ts): the control-plane D1 database and its migrations, and
// the secrets each run generates as `.dev.vars` would hold them.
declare namespace Cloudflare {
  interface Env {
    CONTROL: D1Database;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
    GITHUB_APP_PRIVATE_KEY: string;
    GITHUB_WEBHOOK_SECRET: string;
    REPLY_TOKEN_SECRET: string;
  }
}
