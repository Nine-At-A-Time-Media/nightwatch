// FakeArchiveSink -- ArchiveSink that keeps every archived Outcome.
import type { Outcome } from '../../src/domain/outcome/outcome.js';
import type { ArchiveSink } from '../../src/ports/archive-sink.js';

export class FakeArchiveSink implements ArchiveSink {
  readonly archived: Outcome[] = [];

  async outcomes(outcomes: readonly Outcome[]): Promise<void> {
    this.archived.push(...outcomes);
  }
}
