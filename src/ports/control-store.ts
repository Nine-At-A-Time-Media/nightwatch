/**
 * ControlStore -- control-plane records (architecture Seams: Control-plane
 * records). D1 in production, an in-memory fake in tests. Holds which
 * Organization a Project belongs to, the issuers each Organization trusts,
 * Membership, the Report Reference index and reporter subscriptions.
 *
 * The Report Reference index keeps only the hash of each reference, with the
 * Organization, Project and Report it names, and no reporter address. A
 * Report may have several references; forgetting a Report revokes them all.
 */

import type { Durability } from '../domain/ingest/arrival.js';
import type { IssueId, OrganizationId, ProjectId, ReportId } from '../domain/ids.js';
import type { Member } from '../domain/issue/state.js';
import type { TrustedIssuer } from '../domain/signin/sign-in.js';
import type { Repository } from '../domain/tracker/external-link.js';

/** What a Report Reference's hash names. */
export type ReferenceEntry = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly reportId: ReportId;
};

/** A Member's place in their Organization. */
export type Membership = { readonly organizationId: OrganizationId; readonly role: 'owner' | 'member' };

export interface ControlStore {
  // --- Organizations, Projects and sign-in ---

  organizations(): Promise<readonly OrganizationId[]>;
  /** The Organization a Project belongs to, or null for an unknown Project. */
  organizationOf(projectId: ProjectId): Promise<OrganizationId | null>;
  projectsOf(organizationId: OrganizationId): Promise<readonly ProjectId[]>;
  /** The sign-in issuers the Organization trusts; empty when it trusts none. */
  trustedIssuers(organizationId: OrganizationId): Promise<readonly TrustedIssuer[]>;

  // --- Membership ---

  /** True when the signed-in address belongs to a Member with permission on the Project. */
  isProjectMember(membership: { projectId: ProjectId; email: string }): Promise<boolean>;
  membershipOf(member: Member): Promise<Membership | null>;

  // --- Report Reference index ---

  putReference(hash: string, entry: ReferenceEntry): Promise<Durability>;
  /** What a reference hash names, or null when it is unknown or revoked. */
  findReference(hash: string): Promise<ReferenceEntry | null>;

  // --- reporter subscriptions ---

  isUnsubscribed(reportId: ReportId): Promise<boolean>;
  unsubscribe(reportId: ReportId): Promise<void>;

  /** Revokes every Report Reference of the Report and drops its subscription record. */
  forgetReport(reportId: ReportId): Promise<Durability>;

  // --- task-011: Code and GitHub ---

  /** Whether the Organization's installed app may use the Repository. */
  isRepositoryConnected(connection: { organizationId: OrganizationId; repository: Repository }): Promise<boolean>;
  /** The Organization the Repository is connected to, or null when none is. */
  organizationOfRepository(repository: Repository): Promise<OrganizationId | null>;
  /** Records that the Repositories are no longer connected: the installation or the Repository was removed. */
  disconnectRepositories(repositories: readonly Repository[]): Promise<void>;
  /** Indexes an External Link by its tracker issue, so a Tracker Event finds the Issue it is about. */
  putLinkEntry(entry: LinkEntry): Promise<void>;
  /** What a tracker issue is linked to, or null. */
  findLinkEntry(issue: { repository: Repository; number: number }): Promise<LinkEntry | null>;
  /** Every External Link indexed in any of the Repositories. */
  linkEntriesIn(repositories: readonly Repository[]): Promise<readonly LinkEntry[]>;
  /** The Member a tracker account maps to in the Organization, or null when it maps to none. */
  memberOfTrackerAccount(account: { organizationId: OrganizationId; login: string }): Promise<Member | null>;
  /** The Project of the Organization whose Short Ids carry the slug (any case), or null. */
  projectOfSlug(slug: { organizationId: OrganizationId; slug: string }): Promise<ProjectId | null>;
}

/** Where an External Link's tracker issue points in Nightwatch. */
export type LinkEntry = {
  readonly repository: Repository;
  readonly number: number;
  readonly projectId: ProjectId;
  readonly issueId: IssueId;
};
