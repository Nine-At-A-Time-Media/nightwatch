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
import type { Repository } from '../../src/domain/tracker/external-link.js';
import type { ControlStore, LinkEntry, Membership, ReferenceEntry } from '../../src/ports/control-store.js';

export class FakeControlStore implements ControlStore {
  readonly references = new Map<string, ReferenceEntry>();
  readonly unsubscribed = new Set<ReportId>();
  failure: { retryable: boolean } | null = null;
  readonly #projects = new Map<ProjectId, OrganizationId>();
  readonly #issuers = new Map<OrganizationId, TrustedIssuer[]>();
  readonly #projectMembers = new Map<ProjectId, Set<string>>();
  readonly #memberships = new Map<string, Membership>();
  readonly #repositories = new Map<Repository, OrganizationId>();
  readonly #linkEntries = new Map<string, LinkEntry>();
  readonly #trackerAccounts = new Map<string, Member>();
  readonly #slugs = new Map<string, ProjectId>();

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

  // --- task-011: Code and GitHub ---

  /** Connects the Repository to the Organization through its installed app. */
  connectRepository(organizationId: OrganizationId, repository: Repository): void {
    this.#repositories.set(repository, organizationId);
  }

  /** Maps a tracker account to a Member of the Organization. */
  mapTrackerAccount(organizationId: OrganizationId, login: string, member: Member): void {
    this.#trackerAccounts.set(`${organizationId}/${login.toLowerCase()}`, member);
  }

  /** Gives the Project the slug its Short Ids carry. */
  addProjectSlug(projectId: ProjectId, slug: string): void {
    const organizationId = this.#projects.get(projectId);
    if (organizationId !== undefined) this.#slugs.set(`${organizationId}/${slug.toUpperCase()}`, projectId);
  }

  async isRepositoryConnected(connection: { organizationId: OrganizationId; repository: Repository }): Promise<boolean> {
    return this.#repositories.get(connection.repository) === connection.organizationId;
  }

  async organizationOfRepository(repository: Repository): Promise<OrganizationId | null> {
    return this.#repositories.get(repository) ?? null;
  }

  async disconnectRepositories(repositories: readonly Repository[]): Promise<void> {
    repositories.forEach((repository) => this.#repositories.delete(repository));
  }

  async putLinkEntry(entry: LinkEntry): Promise<void> {
    this.#linkEntries.set(`${entry.repository}#${entry.number}`, entry);
  }

  async findLinkEntry(issue: { repository: Repository; number: number }): Promise<LinkEntry | null> {
    return this.#linkEntries.get(`${issue.repository}#${issue.number}`) ?? null;
  }

  async linkEntriesIn(repositories: readonly Repository[]): Promise<readonly LinkEntry[]> {
    return [...this.#linkEntries.values()].filter((entry) => repositories.includes(entry.repository));
  }

  async memberOfTrackerAccount(account: { organizationId: OrganizationId; login: string }): Promise<Member | null> {
    return this.#trackerAccounts.get(`${account.organizationId}/${account.login.toLowerCase()}`) ?? null;
  }

  async projectOfSlug(slug: { organizationId: OrganizationId; slug: string }): Promise<ProjectId | null> {
    return this.#slugs.get(`${slug.organizationId}/${slug.slug.toUpperCase()}`) ?? null;
  }
}
