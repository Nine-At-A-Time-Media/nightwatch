/**
 * QuotaGate -- the seam for admission Quotas. Each check is scoped to one
 * Project (and Client Key), so one Project's exhausted Quota never refuses
 * another's. An allowed check consumes the quantity.
 */

import type { QuotaDecision, QuotaRequest } from '../domain/ingest/arrival.js';

export interface QuotaGate {
  check(request: QuotaRequest): Promise<QuotaDecision>;
}
