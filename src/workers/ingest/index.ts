/**
 * The ingest Worker's composition root (architecture, Mechanism: Ingest).
 * It also hosts LogDO and QuotaDO until the core Worker lands.
 */

export { LogDO } from './log-do.js';
export { QuotaDO } from './quota-do.js';

export default {
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<IngestEnv>;
