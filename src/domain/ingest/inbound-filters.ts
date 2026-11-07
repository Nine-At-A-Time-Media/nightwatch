/**
 * InboundFilters -- the policy deciding whether a Project's Inbound Filters
 * drop an event before processing (design: Ingest, Filters). Pure functions
 * over the event as parsed JSON; an event of any shape is tolerated.
 */

export type InboundFilterName = 'browser-extensions' | 'localhost' | 'web-crawlers' | 'releases' | 'messages' | 'addresses';

export type InboundFilterConfig = {
  readonly browserExtensions: boolean;
  readonly localhost: boolean;
  readonly webCrawlers: boolean;
  readonly releases: readonly string[];
  readonly messages: readonly string[];
  readonly addresses: readonly string[];
};

type Json = Readonly<Record<string, unknown>>;

const EXTENSION_SCHEMES = /\b(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):\/\//i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);
const CRAWLER_AGENTS =
  /(googlebot|bingbot|yandex(bot|images)|baiduspider|duckduckbot|slurp|applebot|petalbot|ahrefsbot|semrushbot|mj12bot|dotbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|crawler|spider)/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// --- reading an event of unknown shape ---

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function exceptionsOf(event: unknown): readonly unknown[] {
  const exception = field(event, 'exception');
  if (Array.isArray(exception)) return exception;
  const values = field(exception, 'values');
  return Array.isArray(values) ? values : [];
}

function framesOf(event: unknown): readonly unknown[] {
  return exceptionsOf(event).flatMap((exception) => {
    const frames = field(field(exception, 'stacktrace'), 'frames');
    return Array.isArray(frames) ? frames : [];
  });
}

function messagesOf(event: unknown): string[] {
  const message = field(event, 'message');
  const logentry = field(event, 'logentry');
  const plain = [
    text(message),
    text(field(message, 'formatted')),
    text(field(message, 'message')),
    text(field(logentry, 'formatted')),
    text(field(logentry, 'message')),
  ];
  const exceptions = exceptionsOf(event).flatMap((exception) => {
    const type = text(field(exception, 'type'));
    const value = text(field(exception, 'value'));
    return [value, type && value ? `${type}: ${value}` : type];
  });
  return [...plain, ...exceptions].filter((m): m is string => m !== null);
}

function eventUserAgent(event: unknown): string | null {
  const headers = field(field(event, 'request'), 'headers');
  const pairs: unknown[] = Array.isArray(headers) ? headers : isObject(headers) ? Object.entries(headers) : [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0].toLowerCase() === 'user-agent') return text(pair[1]);
  }
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// --- glob matching ---

function globToRegExp(pattern: string, ignoreCase: boolean): RegExp {
  const body = Array.from(pattern, (c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$.+()[\]{}|]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`, ignoreCase ? 'isu' : 'su');
}

export function globMatches({
  pattern,
  text: subject,
  ignoreCase = false,
}: {
  pattern: string;
  text: string;
  ignoreCase?: boolean;
}): boolean {
  return globToRegExp(pattern, ignoreCase).test(subject);
}

// --- addresses ---

function ipv4ToNumber(address: string): number | null {
  const octets = IPV4.exec(address)?.slice(1).map(Number);
  if (!octets || octets.some((o) => o > 255)) return null;
  return octets.reduce((n, o) => n * 256 + o, 0);
}

function isInIpv4Range({ range, address }: { range: string; address: string }): boolean {
  const [base, bitsText] = range.split('/');
  const bits = Number(bitsText);
  const baseNumber = ipv4ToNumber(base ?? '');
  const addressNumber = ipv4ToNumber(address);
  if (baseNumber === null || addressNumber === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const block = 2 ** (32 - bits);
  return Math.floor(baseNumber / block) === Math.floor(addressNumber / block);
}

function isListedAddress({ entry, address }: { entry: string; address: string }): boolean {
  return entry.includes('/') ? isInIpv4Range({ range: entry, address }) : entry.toLowerCase() === address.toLowerCase();
}

// --- the filters ---

function isFromBrowserExtension(event: unknown): boolean {
  const frameUrls = framesOf(event).flatMap((frame) => [text(field(frame, 'abs_path')), text(field(frame, 'filename'))]);
  return [...frameUrls, ...messagesOf(event)].some((s) => s !== null && EXTENSION_SCHEMES.test(s));
}

function isFromLocalhost(event: unknown): boolean {
  const url = text(field(field(event, 'request'), 'url'));
  const host = url === null ? null : hostOf(url);
  const address = text(field(field(event, 'user'), 'ip_address'));
  return (
    (host !== null && (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost'))) || (address !== null && LOOPBACK_ADDRESSES.has(address))
  );
}

function isFromWebCrawler({ event, userAgent }: { event: unknown; userAgent: string | null }): boolean {
  return [eventUserAgent(event), userAgent].some((agent) => agent !== null && CRAWLER_AGENTS.test(agent));
}

function isListedRelease({ event, globs }: { event: unknown; globs: readonly string[] }): boolean {
  const release = text(field(event, 'release'));
  return release !== null && globs.some((pattern) => globMatches({ pattern, text: release }));
}

function isListedMessage({ event, globs }: { event: unknown; globs: readonly string[] }): boolean {
  const messages = messagesOf(event);
  return globs.some((pattern) => messages.some((message) => globMatches({ pattern, text: message, ignoreCase: true })));
}

function isListedClientAddress({ event, entries }: { event: unknown; entries: readonly string[] }): boolean {
  const address = text(field(field(event, 'user'), 'ip_address'));
  return address !== null && entries.some((entry) => isListedAddress({ entry, address }));
}

/** The first of the Project's Inbound Filters that matches the event, or null when none does. */
export function matchingInboundFilter({
  event,
  config,
  userAgent,
}: {
  event: unknown;
  config: InboundFilterConfig;
  userAgent: string | null;
}): InboundFilterName | null {
  if (config.browserExtensions && isFromBrowserExtension(event)) return 'browser-extensions';
  if (config.localhost && isFromLocalhost(event)) return 'localhost';
  if (config.webCrawlers && isFromWebCrawler({ event, userAgent })) return 'web-crawlers';
  if (isListedRelease({ event, globs: config.releases })) return 'releases';
  if (isListedMessage({ event, globs: config.messages })) return 'messages';
  if (isListedClientAddress({ event, entries: config.addresses })) return 'addresses';
  return null;
}
