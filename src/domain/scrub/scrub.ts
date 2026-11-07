/**
 * Scrubbing -- applies Scrubbing Rules to a Normalized Event before it is
 * stored or shown (design Processing, Scrubbing). Field rules remove a
 * whole field, first match wins, checked from the outside in; pattern
 * rules then remove matching text inside every remaining field. Each
 * removal is recorded with its path, rule, method and original length, and
 * never with the value. The event's identity, times, level, platform and
 * normalization record are never scrubbed.
 *
 * Text lives everywhere; free-form data (extra, contexts, breadcrumb data)
 * may also hold numbers and booleans, which are scrubbed as their text.
 * `remove` deletes a field where the event's shape allows it (tags, user,
 * request headers and fields, free-form data) and replaces it elsewhere.
 */

import type { Json, NormalizedEvent } from '../normalize/normalized-event.js';
import { sensitiveSpans, type Span } from './patterns.js';
import type { FieldRule, PatternRule, ScrubbingRules, ScrubMethod } from './rules.js';

export type Removal = { readonly path: string; readonly rule: string; readonly method: ScrubMethod; readonly originalLength: number };

export type ScrubbedEvent = { readonly event: NormalizedEvent; readonly removals: readonly Removal[] };

/** Computes the hash the `hash` method stores in place of a value. */
export type Hash = (text: string) => string;

type Segment = string | number;
type JsonRecord = { readonly [key: string]: Json };

/** Where a value sits: its path, and whether its parent is an object (so it can be deleted). */
type Site = { readonly segments: readonly Segment[]; readonly inObject: boolean };

/** A walked value; `undefined` means the field was deleted. */
type Walked = { readonly value: Json | undefined; readonly removals: readonly Removal[] };

type Scope = { readonly rules: ScrubbingRules; readonly hash: Hash };

type Method = { readonly name: string; readonly method: ScrubMethod; readonly replacement?: string };

const FILTERED = '[Filtered]';
const MASK = '*';
const PROTECTED = new Set(['eventId', 'projectId', 'timestamp', 'receivedAt', 'level', 'platform', 'errors']);
const FREE_FORM_ROOTS = new Set(['extra', 'contexts']);
const DELETABLE_FIELDS = new Set(['tags', 'user']);
const REQUEST_FIELDS = new Set(['url', 'method']);
const BREADCRUMB_DATA_DEPTH = 3;

// --- predicates ---

function isRecord(value: Json): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProtected(segments: readonly Segment[]): boolean {
  return PROTECTED.has(String(segments[0]));
}

function isFreeForm(segments: readonly Segment[]): boolean {
  if (FREE_FORM_ROOTS.has(String(segments[0]))) return segments.length > 1;
  return segments[0] === 'breadcrumbs' && segments[2] === 'data' && segments.length > BREADCRUMB_DATA_DEPTH;
}

function isDeletable(site: Site): boolean {
  const [root, field] = site.segments;
  if (!site.inObject) return false;
  if (isFreeForm(site.segments)) return true;
  if (DELETABLE_FIELDS.has(String(root))) return site.segments.length === 2;
  return root === 'request' && (field === 'headers' ? site.segments.length === 3 : REQUEST_FIELDS.has(String(field)));
}

function isSegmentMatch(glob: string, segment: Segment): boolean {
  const pattern = glob
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}$`, 'i').test(String(segment));
}

function isGlobMatch(parts: readonly string[], segments: readonly Segment[]): boolean {
  const [part, ...restParts] = parts;
  if (part === undefined) return segments.length === 0;
  if (part === '**') return isGlobMatch(restParts, segments) || (segments.length > 0 && isGlobMatch(parts, segments.slice(1)));
  const [segment, ...restSegments] = segments;
  return segment !== undefined && isSegmentMatch(part, segment) && isGlobMatch(restParts, restSegments);
}

function isSensitiveKey(words: readonly string[], segment: Segment): boolean {
  const key = String(segment)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return words.some((word) => key.includes(word));
}

function isFieldMatch(rule: FieldRule, site: Site): boolean {
  if (rule.kind === 'selector') return isGlobMatch(rule.selector.split('.'), site.segments);
  const key = site.segments.at(-1);
  return site.inObject && key !== undefined && isSensitiveKey(rule.words, key);
}

// --- helpers ---

function pathOf(segments: readonly Segment[]): string {
  return segments.join('.');
}

function childSite(site: Site, segment: Segment, inObject: boolean): Site {
  return { segments: [...site.segments, segment], inObject };
}

/** The text a leaf is scrubbed as, or null when the leaf is not scrubbable. */
function leafText(value: Json, segments: readonly Segment[]): string | null {
  if (typeof value === 'string') return value;
  if ((typeof value === 'number' || typeof value === 'boolean') && isFreeForm(segments)) return String(value);
  return null;
}

function replaced(text: string, rule: Method, hash: Hash): string {
  if (rule.method === 'mask') return MASK.repeat(text.length);
  if (rule.method === 'hash') return hash(text);
  if (rule.method === 'replace') return rule.replacement ?? FILTERED;
  return FILTERED;
}

function removal(site: Site, rule: Method, originalLength: number): Removal {
  return { path: pathOf(site.segments), rule: rule.name, method: rule.method, originalLength };
}

function walkedChildren(value: Json, site: Site, walkChild: (child: Json, site: Site) => Walked): Walked {
  if (Array.isArray(value)) {
    const items = value.map((item: Json, index) => walkChild(item, childSite(site, index, false)));
    return { value: items.map((item) => item.value ?? null), removals: items.flatMap((item) => item.removals) };
  }
  if (!isRecord(value)) return { value, removals: [] };
  const entries = Object.entries(value).map(([key, item]) => [key, walkChild(item, childSite(site, key, true))] as const);
  return {
    value: Object.fromEntries(entries.flatMap(([key, item]) => (item.value === undefined ? [] : [[key, item.value] as const]))),
    removals: entries.flatMap(([, item]) => item.removals),
  };
}

// --- flow: field rules ---

/** Removes a whole field under one rule: deleted where allowed, else every scrubbable leaf below it replaced. */
function scrubField(value: Json, site: Site, rule: Method, scope: Scope): Walked {
  if (rule.method === 'remove' && isDeletable(site)) {
    return { value: undefined, removals: [removal(site, rule, leafText(value, site.segments)?.length ?? JSON.stringify(value).length)] };
  }
  const text = leafText(value, site.segments);
  if (text !== null) return { value: replaced(text, rule, scope.hash), removals: [removal(site, rule, text.length)] };
  return walkedChildren(value, site, (child, at) => scrubField(child, at, rule, scope));
}

// --- flow: pattern rules ---

function withoutOverlaps(spans: readonly Span[]): readonly Span[] {
  return spans.filter((span, index) => spans.slice(0, index).every((earlier) => earlier.end <= span.start));
}

function scrubText(
  text: string,
  site: Site,
  rule: PatternRule,
  hash: Hash,
): { readonly text: string; readonly removals: readonly Removal[] } {
  const spans = withoutOverlaps(sensitiveSpans(text, rule.pattern));
  const scrubbed = spans.reduceRight(
    (current, span) => current.slice(0, span.start) + replaced(current.slice(span.start, span.end), rule, hash) + current.slice(span.end),
    text,
  );
  return { text: scrubbed, removals: spans.map((span) => removal(site, rule, span.end - span.start)) };
}

function scrubPatterns(value: Json, site: Site, scope: Scope): Walked {
  const text = leafText(value, site.segments);
  if (text === null) return { value, removals: [] };
  const result = scope.rules.patterns.reduce<{ readonly text: string; readonly removals: readonly Removal[] }>(
    (current, rule) => {
      const next = scrubText(current.text, site, rule, scope.hash);
      return { text: next.text, removals: [...current.removals, ...next.removals] };
    },
    { text, removals: [] },
  );
  return { value: result.removals.length === 0 ? value : result.text, removals: result.removals };
}

// --- flow: the walk ---

function walk(value: Json, site: Site, scope: Scope): Walked {
  if (isProtected(site.segments)) return { value, removals: [] };
  const rule = scope.rules.fields.find((candidate) => isFieldMatch(candidate, site));
  if (rule) return scrubField(value, site, rule, scope);
  if (typeof value === 'object' && value !== null) return walkedChildren(value, site, (child, at) => walk(child, at, scope));
  return scrubPatterns(value, site, scope);
}

// --- exports ---

export function scrubEvent(event: NormalizedEvent, rules: ScrubbingRules, hash: Hash): ScrubbedEvent {
  const walked = walkedChildren(event, { segments: [], inObject: false }, (child, at) => walk(child, at, { rules, hash }));
  return { event: walked.value as NormalizedEvent, removals: walked.removals };
}

/**
 * Every text the `hash` method would hash in this Event, once each, so a
 * caller whose hash is asynchronous can hash them ahead and scrub with a
 * lookup of the results. Scrubbing is deterministic, so the lookup is asked
 * for exactly these texts.
 */
export function textsToHash(event: NormalizedEvent, rules: ScrubbingRules): readonly string[] {
  const texts = new Set<string>();
  scrubEvent(event, rules, (text) => {
    texts.add(text);
    return text;
  });
  return [...texts];
}
