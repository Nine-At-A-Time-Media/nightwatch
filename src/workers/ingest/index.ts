/**
 * The ingest Worker's composition root (architecture, Mechanism: Ingest).
 * It also hosts LogDO and QuotaDO until the core Worker lands.
 */

import { DurableObject } from 'cloudflare:workers';

export class LogDO extends DurableObject<IngestEnv> {}

export class QuotaDO extends DurableObject<IngestEnv> {}

export default {
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<IngestEnv>;
