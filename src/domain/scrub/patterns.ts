/**
 * Value patterns -- finds sensitive text inside a string for the pattern
 * Scrubbing Rules: card numbers (13 to 19 digits, spaces or dashes allowed,
 * Luhn check passed), the token after `Bearer`, and IPv4 or IPv6
 * addresses. Gives the spans to remove; the caller decides how.
 */

import type { ValuePattern } from './rules.js';

export type Span = { readonly start: number; readonly end: number };

const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const BEARER = /\bbearer\s+([A-Za-z0-9\-._~+/]+=*)/dgi;
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`(?<![\\d.])(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}(?!\\d)(?!\\.\\d)`, 'g');
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}(?::[0-9a-f]{1,4}){1,6})(?![\w:])/gi;
const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;
const DECIMAL = 10;
const LUHN_FOLD = 9;

// --- predicates ---

function passesLuhn(digits: string): boolean {
  const sum = [...digits].reverse().reduce((total, char, index) => {
    const digit = Number(char) * (index % 2 === 1 ? 2 : 1);
    return total + (digit > LUHN_FOLD ? digit - LUHN_FOLD : digit);
  }, 0);
  return sum % DECIMAL === 0;
}

function isCardNumber(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  return digits.length >= MIN_CARD_DIGITS && digits.length <= MAX_CARD_DIGITS && passesLuhn(digits);
}

// --- helpers ---

function matchSpans(text: string, pattern: RegExp): readonly Span[] {
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function cardSpans(text: string): readonly Span[] {
  return [...text.matchAll(CARD_CANDIDATE)]
    .filter((match) => isCardNumber(match[0]))
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function bearerSpans(text: string): readonly Span[] {
  return [...text.matchAll(BEARER)].flatMap((match) => {
    const token = match.indices?.[1];
    return token ? [{ start: token[0], end: token[1] }] : [];
  });
}

function ipSpans(text: string): readonly Span[] {
  return [...matchSpans(text, IPV4), ...matchSpans(text, IPV6)].sort((a, b) => a.start - b.start);
}

// --- exports ---

/** The spans of `text` a pattern marks as sensitive, in order and not overlapping. */
export function sensitiveSpans(text: string, pattern: ValuePattern): readonly Span[] {
  if (pattern === 'credit-card') return cardSpans(text);
  if (pattern === 'bearer-token') return bearerSpans(text);
  return ipSpans(text);
}
