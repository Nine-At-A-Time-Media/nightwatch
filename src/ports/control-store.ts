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
import type { OrganizationId, ProjectId, ReportId } from '../domain/ids.js';
import type { Member } from '../domain/issue/state.js';
import type { TrustedIssuer } from '../domain/signin/sign-in.js';

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
}
