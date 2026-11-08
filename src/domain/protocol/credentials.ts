/**
 * Credential location -- an SDK may present its Client Key in exactly one of
 * several places. More than one, or none, is refused.
 */

import { refusal, type Refusal } from '../refusal.js';

export type RequestParts = {
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly pathKey: string | null;
};

export type Credentials = { readonly publicKey: string; readonly client: string | null };

type Found = Credentials | Refusal | null;

function parseKeyValueList(text: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const part of text.split(',')) {
    const [key, ...rest] = part.trim().split('=');
    if (key && rest.length) pairs[key.trim()] = rest.join('=').trim();
  }
  return pairs;
}

function fromSentryScheme(value: string): Found {
  const pairs = parseKeyValueList(value.replace(/^Sentry\s+/i, ''));
  return pairs['sentry_key'] ? { publicKey: pairs['sentry_key'], client: pairs['sentry_client'] ?? null } : refusal('missing-credentials');
}

function fromBasic(value: string): Found {
  try {
    const key = atob(value.replace(/^Basic\s+/i, '')).split(':')[0];
    return key ? { publicKey: key, client: null } : refusal('missing-credentials');
  } catch {
    return refusal('malformed-credentials');
  }
}

function fromAuthHeader(parts: RequestParts): Found {
  const value = parts.headers['x-sentry-auth'];
  return value === undefined ? null : fromSentryScheme(value);
}

function fromAuthorization(parts: RequestParts): Found {
  const value = parts.headers['authorization'];
  if (value === undefined) return null;
  if (/^Sentry\s/i.test(value)) return fromSentryScheme(value);
  if (/^Basic\s/i.test(value)) return fromBasic(value);
  return null;
}

function fromQuery(parts: RequestParts): Found {
  const key = parts.query['sentry_key'];
  return key ? { publicKey: key, client: parts.query['sentry_client'] ?? null } : null;
}

function fromPath(parts: RequestParts): Found {
  return parts.pathKey ? { publicKey: parts.pathKey, client: null } : null;
}

export function locateCredentials(parts: RequestParts): Credentials | Refusal {
  const found = [fromAuthHeader(parts), fromAuthorization(parts), fromQuery(parts), fromPath(parts)].filter(
    (f): f is Credentials | Refusal => f !== null,
  );
  if (found.length > 1) return refusal('multiple-credentials');
  return found[0] ?? refusal('missing-credentials');
}
