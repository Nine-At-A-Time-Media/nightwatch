/**
 * Key sources for the Access adapter -- where an issuer's public signing keys
 * come from. Production reads each issuer's published JWKS over HTTPS; local
 * development and tests hand over JWKS objects directly, so no network is
 * touched.
 */

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  type CompactVerifyGetKey,
  type FetchImplementation,
  type JSONWebKeySet,
} from 'jose';

const CERTS_PATH = '/cdn-cgi/access/certs';

/** Supplies the key-selection function for one issuer's assertions. */
export interface KeySource {
  keysFor(issuer: string): CompactVerifyGetKey;
}

// --- helpers ---

function certsUrl(issuer: string): URL {
  return new URL(`${issuer.replace(/\/+$/, '')}${CERTS_PATH}`);
}

async function noKeys(): Promise<never> {
  throw new Error('no keys are published for this issuer');
}

// --- exports ---

/** Reads each issuer's keys from `<issuer>/cdn-cgi/access/certs`; `fetch` overrides the HTTP client. */
export function remoteKeySource(options: { fetch?: FetchImplementation } = {}): KeySource {
  const fetchOption = options.fetch ? { [customFetch]: options.fetch } : {};
  return { keysFor: (issuer) => createRemoteJWKSet(certsUrl(issuer), fetchOption) };
}

/** Serves keys from JWKS objects held in memory, keyed by issuer. */
export function localKeySource(jwksByIssuer: Readonly<Record<string, JSONWebKeySet>>): KeySource {
  return {
    keysFor: (issuer) => {
      const jwks = jwksByIssuer[issuer];
      return jwks ? createLocalJWKSet(jwks) : noKeys;
    },
  };
}
