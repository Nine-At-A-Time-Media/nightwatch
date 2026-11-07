/**
 * FakeProjectClient -- the ProjectClient's second mechanism: a direct call
 * into an in-process IssueStore per Project (architecture Seams). Writes run
 * the ProjectDO use case or step of the same name against that Project's
 * FakeIssueStore; reads return what the store holds. `store(projectId)`
 * hands a test the store, to set a Given or inspect the result.
 */

import { openReportIssue } from '../../src/application/reports/open-report-issue.js';
import { assignEvent } from '../../src/application/issues/assign-event.js';
import { recordReleaseSeen } from '../../src/application/issues/record-release-seen.js';
import type { EventSummary } from '../../src/domain/event/event-summary.js';
import type { Fingerprint } from '../../src/domain/grouping/fingerprint.js';
import type { IssueId, ProjectId, ReportId } from '../../src/domain/ids.js';
import type { Assignment } from '../../src/domain/issue/assignment.js';
import type { IssuePolicies } from '../../src/domain/issue/policies.js';
import type { IssueChange } from '../../src/domain/issue/state.js';
import type { Release } from '../../src/domain/release/ordering.js';
import type { Report } from '../../src/domain/report/report.js';
import type { Comment, ReportStatusChange } from '../../src/domain/report/thread.js';
import type { Clock } from '../../src/ports/clock.js';
import type { EffectQueue } from '../../src/ports/effect-queue.js';
import type { Ids } from '../../src/ports/ids.js';
import type { ProjectClient } from '../../src/ports/project-client.js';
import { FakeIssueStore } from './issue-store.js';

export type ProjectSide = { clock: Clock; ids: Ids; effects: EffectQueue; policies: IssuePolicies; dedupWindow: number };

export class FakeProjectClient implements ProjectClient {
  readonly #side: ProjectSide;
  readonly #stores = new Map<ProjectId, FakeIssueStore>();

  /** `side` is what the ProjectDO composition root would hand its use cases. */
  constructor(side: ProjectSide) {
    this.#side = side;
  }

  /** The Project's store, created empty on first use. */
  store(projectId: ProjectId): FakeIssueStore {
    const existing = this.#stores.get(projectId);
    if (existing) return existing;
    const created = new FakeIssueStore({ dedupWindow: this.#side.dedupWindow });
    this.#stores.set(projectId, created);
    return created;
  }

  async assignEvent(projectId: ProjectId, summary: EventSummary, fingerprints: Fingerprint[]): Promise<Assignment> {
    const { clock, ids, policies } = this.#side;
    return assignEvent(summary, fingerprints, { issues: this.store(projectId), clock, ids, policies });
  }

  async recordReleaseSeen(projectId: ProjectId, release: Release): Promise<IssueChange[]> {
    const { clock, effects } = this.#side;
    return recordReleaseSeen(release, { issues: this.store(projectId), effects, clock });
  }

  async openReportIssue(projectId: ProjectId, report: Report): Promise<IssueChange[]> {
    return openReportIssue(report, { issues: this.store(projectId) });
  }

  async getReport(projectId: ProjectId, reportId: ReportId): Promise<Report | null> {
    return this.store(projectId).getReport(reportId);
  }

  async reportsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]> {
    return this.store(projectId).reportsOn(issueId);
  }

  async statusChangesOf(projectId: ProjectId, reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return this.store(projectId).statusChangesOf(reportId);
  }

  async commentsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]> {
    return this.store(projectId).commentsOn(issueId);
  }
}
