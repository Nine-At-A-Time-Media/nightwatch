/**
 * CODEOWNERS -- a repository's owners file, as GitHub reads it, in the
 * subset Nightwatch uses (design Code and GitHub, CODEOWNERS). One entry per
 * line: a path pattern, then owners (`@login`, `@org/team`, or an address).
 * `#` starts a comment line. The last matching line wins; a matching line
 * with no owners leaves the path unowned.
 *
 * Patterns follow the ignore-file convention: a leading `/`, or a `/`
 * anywhere but at the end, anchors the pattern at the repository root;
 * otherwise it matches at any depth. A trailing `/` matches only what is
 * below a directory. A pattern matching a directory matches everything
 * below it. `*` stays within a path segment and `**` crosses them. Owner
 * words that are none of the three forms are skipped.
 */

import { pathGlobSource } from './glob.js';
import { isEmailAddress, type OwnerRef } from './owner.js';

export type CodeownersEntry = { readonly pattern: string; readonly owners: readonly OwnerRef[] };

const LINE_BREAK = /\r\n|\r|\n/;
const WHITESPACE = /\s+/;
const LOGIN = /^@([A-Za-z0-9-]+)$/;
const TRACKER_TEAM = /^@([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)$/;

// --- sub-component: parsing ---

function isSkipped(line: string): boolean {
  return line === '' || line.startsWith('#');
}

function ownerOf(text: string): OwnerRef | null {
  const login = LOGIN.exec(text)?.[1];
  if (login !== undefined) return { kind: 'login', login };
  const slug = TRACKER_TEAM.exec(text)?.[1];
  if (slug !== undefined) return { kind: 'tracker_team', slug };
  return isEmailAddress(text) ? { kind: 'email', email: text } : null;
}

export function parseCodeowners(text: string): readonly CodeownersEntry[] {
  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => !isSkipped(line))
    .map((line) => {
      const [pattern = '', ...owners] = line.split(WHITESPACE);
      return { pattern, owners: owners.map(ownerOf).filter((owner): owner is OwnerRef => owner !== null) };
    });
}

// --- sub-component: matching ---

function isAnchored(pattern: string): boolean {
  return pattern.startsWith('/') || pattern.replace(/\/+$/, '').includes('/');
}

function patternRegExp(pattern: string): RegExp {
  const directoryOnly = pattern.endsWith('/');
  const body = pathGlobSource(pattern.replace(/^\/+/, '').replace(/\/+$/, ''));
  const prefix = isAnchored(pattern) ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${body}${directoryOnly ? '/.*' : '(?:/.*)?'}$`);
}

/** The owners of the repository path: those of the last matching line; empty when none matches. */
export function ownersByCodeowners(entries: readonly CodeownersEntry[], path: string): readonly OwnerRef[] {
  return entries.findLast((entry) => patternRegExp(entry.pattern).test(path))?.owners ?? [];
}
