/**
 * Message parameterization -- replaces the volatile values in a message
 * (addresses, ids, hashes, times, numbers) with placeholders, so that two
 * occurrences of one message template derive the same Fingerprint.
 *
 * Quoted strings are kept as written: they usually name a key, a field or a
 * file, which tells crashes apart. A project that wants them merged writes a
 * Fingerprint Rule. Parameterizing is idempotent.
 */

// Ordered: earlier patterns swallow text the later ones would split apart.
const URL = /(?<![\w>])[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const UUID = /(?<![\w>-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w<-])/gi;
const DATE = /(?<![\w>-])\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d<-])/g;
const TIME = /(?<![\w>:])\d{2}:\d{2}:\d{2}(?:\.\d+)?(?![\w<:])/g;
const IPV4 = /(?<![\w>.])(?:\d{1,3}\.){3}\d{1,3}(?![\w<.]|\.\d)/g;
const IPV6_CANDIDATE = /(?<![\w>:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w<:])/gi;
const HEX = /(?<![\w>])(?:0x[0-9a-f]+|[0-9a-f]{16,})(?![\w<])/gi;
const FLOAT = /(?<![\w.])\d+\.\d+(?![\d_])(?!\.\d)/g;
const INT = /(?<![\w.])\d+(?![\d_])(?!\.\d)/g;

const MD5_LENGTH = 32;
const SHA1_LENGTH = 40;
const IPV6_FULL_COLONS = 7;

// --- predicates ---

function hasDigit(text: string): boolean {
  return /\d/.test(text);
}

function isIpv6(candidate: string): boolean {
  const colons = candidate.split(':').length - 1;
  const compressed = candidate.split('::').length - 1;
  return hasDigit(candidate) && compressed <= 1 && (compressed === 1 || colons === IPV6_FULL_COLONS);
}

// --- helpers ---

function ipv6Placeholder(candidate: string): string {
  return isIpv6(candidate) ? '<ipv6>' : candidate;
}

function hexPlaceholder(hex: string): string {
  if (/^0x/i.test(hex)) return '<hex>';
  if (!hasDigit(hex)) return hex;
  if (hex.length === MD5_LENGTH) return '<md5>';
  if (hex.length === SHA1_LENGTH) return '<sha1>';
  return '<hex>';
}

// --- exports ---

export function parameterize(message: string): string {
  return message
    .replace(URL, '<url>')
    .replace(EMAIL, '<email>')
    .replace(UUID, '<uuid>')
    .replace(DATE, '<date>')
    .replace(TIME, '<time>')
    .replace(IPV4, '<ipv4>')
    .replace(IPV6_CANDIDATE, ipv6Placeholder)
    .replace(HEX, hexPlaceholder)
    .replace(FLOAT, '<float>')
    .replace(INT, '<int>');
}
