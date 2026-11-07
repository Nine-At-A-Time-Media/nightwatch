// FakeArchiveQuery -- an ArchiveQuery over Outcomes a test seeds; keeps every query for assertions.
import type { ProjectId } from '../../src/domain/ids.js';
import type { Outcome } from '../../src/domain/outcome/outcome.js';
import { isWithinRange, type TimeRange } from '../../src/domain/time-range.js';
import type { ArchiveQuery } from '../../src/ports/archive-query.js';

export class FakeArchiveQuery implements ArchiveQuery {
  readonly queries: { projectId: ProjectId; range: TimeRange }[] = [];
  readonly #outcomes: Outcome[] = [];

  seed(outcomes: readonly Outcome[]): void {
    this.#outcomes.push(...outcomes);
  }

  async outcomes(query: { projectId: ProjectId; range: TimeRange }): Promise<readonly Outcome[]> {
    this.queries.push(query);
    return this.#outcomes.filter((outcome) => outcome.projectId === query.projectId && isWithinRange(outcome.recordedAt, query.range));
  }
}
