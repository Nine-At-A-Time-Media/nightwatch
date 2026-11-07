/**
 * FakeControlStore -- an in-memory ControlStore. Tests seed Organizations,
 * Projects, trusted issuers and Members with the `add*` helpers; the
 * Reference index and subscriptions are exposed for assertions. `failure`
 * makes every write that reports Durability fail.
 */

import type { Durability } from '../../src/domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../../src/domain/ids.js';
import type { Member } from '../../src/domain/issue/state.js';
import type { ProcessingConfig } from '../../src/domain/processing/processing.js';
import type { TrustedIssuer } from '../../src/domain/signin/sign-in.js';
import type { Artifact, ArtifactQuery } from '../../src/domain/sourcemap/artifact.js';
import type { ControlStore, Membership, ReferenceEntry } from '../../src/ports/control-store.js';

export class FakeControlStore implements ControlStore {
  readonly references = new Map<string, ReferenceEntry>();
  readonly unsubscribed = new Set<ReportId>();
  failure: { retryable: boolean } | null = null;
  readonly #projects = new Map<ProjectId, OrganizationId>();
  readonly #issuers = new Map<OrganizationId, TrustedIssuer[]>();
  readonly #projectMembers = new Map<ProjectId, Set<string>>();
  readonly #memberships = new Map<string, Membership>();

  /** Adds a Project to an Organization, creating the Organization if needed. */
  addProject(organizationId: OrganizationId, projectId: ProjectId): void {
    this.#projects.set(projectId, organizationId);
    if (!this.#issuers.has(organizationId)) this.#issuers.set(organizationId, []);
  }

  addTrustedIssuer(organizationId: OrganizationId, issuer: TrustedIssuer): void {
    this.#issuers.set(organizationId, [...(this.#issuers.get(organizationId) ?? []), issuer]);
  }

  /** Makes the address a Member with permission on the Project. */
  addProjectMember(projectId: ProjectId, email: string): void {
    this.#projectMembers.set(projectId, new Set([...(this.#projectMembers.get(projectId) ?? []), email.toLowerCase()]));
  }

  addMembership(member: Member, membership: Membership): void {
    this.#memberships.set(member.member, membership);
  }

  async organizations(): Promise<readonly OrganizationId[]> {
    return [...this.#issuers.keys()];
  }

  async organizationOf(projectId: ProjectId): Promise<OrganizationId | null> {
    return this.#projects.get(projectId) ?? null;
  }

  async projectsOf(organizationId: OrganizationId): Promise<readonly ProjectId[]> {
    return [...this.#projects].filter(([, org]) => org === organizationId).map(([projectId]) => projectId);
  }

  async trustedIssuers(organizationId: OrganizationId): Promise<readonly TrustedIssuer[]> {
    return this.#issuers.get(organizationId) ?? [];
  }

  async isProjectMember(membership: { projectId: ProjectId; email: string }): Promise<boolean> {
    return this.#projectMembers.get(membership.projectId)?.has(membership.email.toLowerCase()) ?? false;
  }

  async membershipOf(member: Member): Promise<Membership | null> {
    return this.#memberships.get(member.member) ?? null;
  }

  async putReference(hash: string, entry: ReferenceEntry): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.references.set(hash, entry);
    return { ok: true };
  }

  async findReference(hash: string): Promise<ReferenceEntry | null> {
    return this.references.get(hash) ?? null;
  }

  async isUnsubscribed(reportId: ReportId): Promise<boolean> {
    return this.unsubscribed.has(reportId);
  }

  async unsubscribe(reportId: ReportId): Promise<void> {
    this.unsubscribed.add(reportId);
  }

  async forgetReport(reportId: ReportId): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    [...this.references].filter(([, entry]) => entry.reportId === reportId).forEach(([hash]) => this.references.delete(hash));
    this.unsubscribed.delete(reportId);
    return { ok: true };
  }

  // --- task-008: processing config and the Artifact index ---

  readonly #processing = new Map<ProjectId, ProcessingConfig>();
  readonly #artifacts = new Map<ProjectId, Artifact[]>();

  setProcessingConfig(projectId: ProjectId, config: ProcessingConfig): void {
    this.#processing.set(projectId, config);
  }

  addArtifact(projectId: ProjectId, artifact: Artifact): void {
    this.#artifacts.set(projectId, [...(this.#artifacts.get(projectId) ?? []), artifact]);
  }

  async processingConfig(projectId: ProjectId): Promise<ProcessingConfig | null> {
    return this.#processing.get(projectId) ?? null;
  }

  async artifactsFor(projectId: ProjectId, query: ArtifactQuery): Promise<readonly Artifact[]> {
    const plain = (id: string) => id.replaceAll('-', '').toLowerCase();
    const debugIds = new Set(query.debugIds.map(plain));
    return (this.#artifacts.get(projectId) ?? []).filter(
      (artifact) =>
        (query.release !== null && artifact.release === query.release) ||
        (artifact.debugId !== null && debugIds.has(plain(artifact.debugId))),
    );
  }
}
