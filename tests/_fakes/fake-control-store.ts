/**
 * FakeControlStore -- an in-memory ControlStore. Tests seed Organizations,
 * Projects, trusted issuers and Members with the `add*` helpers; the
 * Reference index and subscriptions are exposed for assertions. `failure`
 * makes every write that reports Durability fail.
 */

import type { Durability } from '../../src/domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../../src/domain/ids.js';
import type { Member } from '../../src/domain/issue/state.js';
import type { TrustedIssuer } from '../../src/domain/signin/sign-in.js';
import type { AccessTokenRecord } from '../../src/domain/tenancy/access-token.js';
import type { Release } from '../../src/domain/release/ordering.js';
import { normalizedDebugId, type Artifact } from '../../src/domain/sourcemap/artifact.js';
import type { ControlStore, Membership, ReferenceEntry } from '../../src/ports/control-store.js';

/** An Artifact index entry with the Organization it belongs to. */
export type IndexedArtifact = { readonly organizationId: OrganizationId; readonly artifact: Artifact };

export class FakeControlStore implements ControlStore {
  readonly references = new Map<string, ReferenceEntry>();
  readonly unsubscribed = new Set<ReportId>();
  failure: { retryable: boolean } | null = null;
  readonly #projects = new Map<ProjectId, OrganizationId>();
  readonly #issuers = new Map<OrganizationId, TrustedIssuer[]>();
  readonly #projectMembers = new Map<ProjectId, Set<string>>();
  readonly #memberships = new Map<string, Membership>();
  // --- task-022: Access Tokens by hash, exposed for assertions ---
  readonly accessTokens = new Map<string, AccessTokenRecord>();
  // --- task-022: the Artifact index, exposed for assertions ---
  readonly artifacts: IndexedArtifact[] = [];

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

  // --- task-022: Access Tokens, kept only as hashes ---

  async putAccessToken(hash: string, record: AccessTokenRecord): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.accessTokens.set(hash, record);
    return { ok: true };
  }

  async findAccessToken(hash: string): Promise<AccessTokenRecord | null> {
    return this.accessTokens.get(hash) ?? null;
  }

  // --- task-022: the Artifact index ---

  async putArtifact(organizationId: OrganizationId, artifact: Artifact): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    const same = (entry: IndexedArtifact) =>
      entry.organizationId === organizationId &&
      entry.artifact.id === artifact.id &&
      entry.artifact.debugId === artifact.debugId &&
      entry.artifact.release === artifact.release &&
      entry.artifact.fileName === artifact.fileName;
    if (!this.artifacts.some(same)) this.artifacts.push({ organizationId, artifact });
    return { ok: true };
  }

  async findArtifacts(lookup: {
    organizationId: OrganizationId;
    debugIds: readonly string[];
    release: Release | null;
  }): Promise<readonly Artifact[]> {
    return this.artifacts
      .filter(({ organizationId }) => organizationId === lookup.organizationId)
      .map(({ artifact }) => artifact)
      .filter(
        (artifact) =>
          (artifact.debugId !== null &&
            lookup.debugIds.some((id) => normalizedDebugId(id) === normalizedDebugId(artifact.debugId ?? ''))) ||
          (lookup.release !== null && artifact.release === lookup.release),
      );
  }
}
