/**
 * Quoted text -- what the replier wrote in a reply to an issue notification
 * email, without the notification they quoted (architecture Module map:
 * src/domain/mail; Mechanism, Alerts and notifications). The reply ends at
 * the first attribution line ("On ... wrote:") or signature separator
 * ("--"); quoted lines (starting with ">") are dropped wherever they are.
 */

const ATTRIBUTION = /^\s*On\s.*\swrote:\s*$/;
const SIGNATURE = /^\s*--\s*$/;
const QUOTED = /^\s*>/;

// --- predicates ---

function isEndOfReply(line: string): boolean {
  return ATTRIBUTION.test(line) || SIGNATURE.test(line);
}

function isQuoted(line: string): boolean {
  return QUOTED.test(line);
}

// --- exports ---

/** The replier's own words, trimmed; empty when they wrote nothing. */
export function replyText(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const end = lines.findIndex(isEndOfReply);
  const own = end === -1 ? lines : lines.slice(0, end);
  return own
    .filter((line) => !isQuoted(line))
    .join('\n')
    .trim();
}
