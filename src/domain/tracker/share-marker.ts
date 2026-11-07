/**
 * Share marker -- the rule that marks a GitHub comment for the reporter
 * (design Code and GitHub, Comments; Behaviors: Shared GitHub comment).
 *
 * A comment is shared when its first line, trimmed, is exactly the share
 * marker; what follows, trimmed, is the text that enters each Report's
 * Thread. The marker's spelling is a value the caller supplies. Who may use
 * the marker is not decided here: the Security Considerations require its
 * author to map to a Member, which the caller checks.
 */

const LINE_BREAK = /\r\n|\r|\n/;

// --- predicates ---

function isBlank(text: string): boolean {
  return text.trim() === '';
}

// --- exports ---

/** The shared text of a comment marked for the reporter, or null when the comment is not shared. */
export function sharedCommentText(body: string, marker: string): string | null {
  if (isBlank(marker)) return null;
  const match = LINE_BREAK.exec(body);
  const firstLine = match === null ? body : body.slice(0, match.index);
  if (firstLine.trim() !== marker.trim()) return null;
  const rest = match === null ? '' : body.slice(match.index + match[0].length).trim();
  return rest === '' ? null : rest;
}
