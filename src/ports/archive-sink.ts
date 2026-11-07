/**
 * ArchiveSink -- the seam for the analytical archive. Outcomes written here
 * are exact; Outcome totals are read from the archive. Processed Event
 * Summaries are archived beside them.
 */

import type { EventSummary } from '../domain/event/event-summary.js';
import type { ProjectId } from '../domain/ids.js';
import type { Outcome } from '../domain/outcome/outcome.js';

export interface ArchiveSink {
  outcomes(outcomes: readonly Outcome[]): Promise<void>;

  // --- task-008: processed Event Summaries ---

  /** Archives the Event Summaries of a Project's newly processed Events (architecture Retention, archive and usage). */
  events(projectId: ProjectId, summaries: readonly EventSummary[]): Promise<void>;
}
