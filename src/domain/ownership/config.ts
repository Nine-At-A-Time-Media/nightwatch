/**
 * Ownership config -- what a Project sets for owner suggestions (design
 * Issues, Ownership; Code and GitHub, Code links; Behaviors: Owner
 * suggested): its Ownership Rules as written, its Code Mappings, and whether
 * it auto-assigns a suggested owner. A Project that set none has no rules,
 * no mappings, and does not auto-assign. The Suspect Commit Window is a
 * github runtime setting (architecture Parameters placed).
 */

import type { CodeMapping } from './code-mapping.js';

export type OwnershipConfig = {
  /** The Ownership Rules text, in the rule language of ownership-rules. */
  readonly ownershipRules: string;
  readonly codeMappings: readonly CodeMapping[];
  /** Whether the first suggested owner becomes the Assignee of an Issue that has none. */
  readonly autoAssign: boolean;
};

/** The github runtime's settings for owner suggestions. */
export type OwnershipSettings = {
  /** The Suspect Commit Window, in milliseconds before the Issue was first seen. */
  readonly suspectCommitWindow: number;
};

export const NO_OWNERSHIP_CONFIG: OwnershipConfig = { ownershipRules: '', codeMappings: [], autoAssign: false };
