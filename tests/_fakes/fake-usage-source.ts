// FakeUsageSource -- a UsageSource that answers the product use a test sets.
import type { ProductUsage } from '../../src/domain/operating/platform-usage.js';
import type { UsageSource } from '../../src/ports/usage-source.js';

export class FakeUsageSource implements UsageSource {
  measured: readonly ProductUsage[];

  constructor(measured: readonly ProductUsage[] = []) {
    this.measured = measured;
  }

  async usage(): Promise<readonly ProductUsage[]> {
    return this.measured;
  }
}
