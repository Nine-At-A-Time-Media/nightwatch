/**
 * UsageSource -- the seam for Platform Usage (architecture Seams: Platform
 * usage). The Cloudflare account analytics API in production, a fake in
 * tests and locally.
 */

import type { ProductUsage } from '../domain/operating/platform-usage.js';

export interface UsageSource {
  /** Each product's use in the current period. */
  usage(): Promise<readonly ProductUsage[]>;
}
