// FakeArchiveSink -- ArchiveSink that keeps every archived Outcome and Event Summary.
import type { EventSummary } from '../../src/domain/event/event-summary.js';
import type { ProjectId } from '../../src/domain/ids.js';
import type { Outcome } from '../../src/domain/outcome/outcome.js';
import type { ArchiveSink } from '../../src/ports/archive-sink.js';

export class FakeArchiveSink implements ArchiveSink {
  readonly archived: Outcome[] = [];

  async outcomes(outcomes: readonly Outcome[]): Promise<void> {
    this.archived.push(...outcomes);
  }

  // --- task-008: processed Event Summaries ---

  readonly archivedEvents: { projectId: ProjectId; summary: EventSummary }[] = [];

  async events(projectId: ProjectId, summaries: readonly EventSummary[]): Promise<void> {
    this.archivedEvents.push(...summaries.map((summary) => ({ projectId, summary })));
  }
}
