/**
 * ControlStore -- control-plane records (architecture Seams: Control-plane
 * records). D1 in production, an in-memory fake in tests. Holds which
 * Organization a Project belongs to, the issuers each Organization trusts,
 * Membership, the Report Reference index, reporter subscriptions, and
 * Access Tokens (by hash), each Project's processing config, alert rules
 * and recipients, Members' notification settings, and the Artifact index,
 * which is kept per Organization and read through a Project.
 *
 * The Report Reference index keeps only the hash of each reference, with the
 * Organization, Project and Report it names, and no reporter address. A
 * Report may have several references; forgetting a Report revokes them all.
 */

import type { EmailRecipient, IssueAlertRule } from '../domain/alerts/issue-alert-rule.js';
import type { NotificationSettings } from '../domain/alerts/notification-settings.js';
import type { Durability } from '../domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../domain/ids.js';
import type { Member } from '../domain/issue/state.js';
import type { ProcessingConfig } from '../domain/processing/processing.js';
import type { TrustedIssuer } from '../domain/signin/sign-in.js';
import type { AccessTokenRecord } from '../domain/tenancy/access-token.js';
import type { Artifact, ArtifactQuery } from '../domain/sourcemap/artifact.js';

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

  // --- task-022: Access Tokens, kept only as hashes ---

  /** Keeps (or replaces, as on revocation) the record of the token with this hash. */
  putAccessToken(hash: string, record: AccessTokenRecord): Promise<Durability>;
  /** The record of the token with this hash, or null when none was kept. */
  findAccessToken(hash: string): Promise<AccessTokenRecord | null>;

  // --- task-022: the Artifact index ---

  /** Indexes an Artifact within its Organization; indexing an identical entry again changes nothing. */
  putArtifact(organizationId: OrganizationId, artifact: Artifact): Promise<Durability>;
  // --- task-021: alert rules, recipients and notification settings ---

  /** The Project's Issue Alert Rules; empty when it has none. */
  issueAlertRules(projectId: ProjectId): Promise<readonly IssueAlertRule[]>;
  /** The Members an email action names in the Project: its owners, a Team's Members, or one Member. */
  recipientsOf(recipient: { projectId: ProjectId; to: EmailRecipient }): Promise<readonly Member[]>;
  /** The Member's address, or null for an unknown Member. */
  addressOf(member: Member): Promise<string | null>;
  /** Every Member with permission on the Project. */
  projectMembers(projectId: ProjectId): Promise<readonly Member[]>;
  /** The Member's notification settings; empty settings when they set none. */
  notificationSettingsOf(member: Member): Promise<NotificationSettings>;
  // --- task-008: processing config and the Artifact index ---

  /** What processing reads about a Project (Scrubbing, Fingerprint and Stack Trace Rules, Grouping Version, Event Retention); null for an unknown Project. */
  processingConfig(projectId: ProjectId): Promise<ProcessingConfig | null>;
  /**
   * The Artifact index entries of the Project's Organization (where putArtifact
   * indexed them) of the query's release, or carrying one of its debug ids
   * (compared in normalizedDebugId form), in the order they were indexed;
   * empty for an unknown Project. The one Artifact index read.
   */
  artifactsFor(projectId: ProjectId, query: ArtifactQuery): Promise<readonly Artifact[]>;
}
