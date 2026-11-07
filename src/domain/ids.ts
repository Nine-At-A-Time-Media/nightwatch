/**
 * Identifiers (design Values the behaviors exchange: Project Id, Issue Id;
 * Domain Language: Organization, Report).
 * Each is stable and never reused. An Event Id is the id the SDK gave the
 * Event; it keys every write about that Event, so processing it twice is
 * recognised.
 */

export type ProjectId = string;
export type IssueId = string;
export type EventId = string;
export type OrganizationId = string;
export type ReportId = string;
