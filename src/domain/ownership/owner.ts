/**
 * Owner references -- whom an Ownership Rule or a CODEOWNERS line names,
 * before account mapping turns them into Members or Teams (design Issues,
 * Ownership; Code and GitHub, CODEOWNERS). An Ownership Rule names a Member
 * by address or a Team as `#name`; a CODEOWNERS line names a tracker account
 * as `@login`, a tracker team as `@org/team`, or an address.
 */

export type OwnerRef =
  | { readonly kind: 'email'; readonly email: string }
  | { readonly kind: 'team'; readonly team: string }
  | { readonly kind: 'login'; readonly login: string }
  | { readonly kind: 'tracker_team'; readonly slug: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- exports ---

export function isEmailAddress(text: string): boolean {
  return EMAIL.test(text);
}
