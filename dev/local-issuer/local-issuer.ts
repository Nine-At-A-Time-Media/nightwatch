/**
 * Local issuer -- the development and test stand-in for Cloudflare Access
 * (architecture, Sign-in and Local development). It holds an RS256 key pair
 * generated on creation (or restored from a saved private key, so one checkout
 * keeps one issuer), publishes the public half as a JWKS, and mints
 * assertions shaped like Access application tokens. Pure TypeScript; the
 * Worker that serves it in the dev session (worker.ts) wraps this module.
 */

import { exportJWK, generateKeyPair, importJWK, SignJWT, type CryptoKey, type JSONWebKeySet, type JWK } from 'jose';

const ALGORITHM = 'RS256';
const KEY_ID = 'local-issuer-1';

export type MintOptions = {
  readonly email: string;
  readonly aud: string | readonly string[];
  readonly ttlSeconds: number;
  /** When the assertion is issued; defaults to the wall clock. */
  readonly issuedAt?: Date;
};

// --- helpers ---

/** The public members of an RSA JWK; the private ones (d, p, q, dp, dq, qi) are left out. */
function publicJwkOf(jwk: JWK): JWK {
  const { kty, n, e } = jwk;
  if (kty !== 'RSA' || n === undefined || e === undefined) throw new Error('the saved local issuer key is not an RSA key');
  return { kty, n, e, kid: KEY_ID, alg: ALGORITHM, use: 'sig' };
}

function audienceList(aud: string | readonly string[]): string[] {
  return typeof aud === 'string' ? [aud] : [...aud];
}

// --- exports ---

export class LocalIssuer {
  /** The issuer URL; its keys are published at `<issuer>/cdn-cgi/access/certs`. */
  readonly issuer: string;
  /** The public keys, as a JSON Web Key Set. */
  readonly jwks: JSONWebKeySet;
  readonly #privateKey: CryptoKey;

  private constructor(options: { issuer: string; jwks: JSONWebKeySet; privateKey: CryptoKey }) {
    this.issuer = options.issuer;
    this.jwks = options.jwks;
    this.#privateKey = options.privateKey;
  }

  /** Generates a fresh key pair for an issuer at `issuer` (a team-domain-shaped URL). */
  static async create(issuer: string): Promise<LocalIssuer> {
    const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: ALGORITHM, use: 'sig' };
    return new LocalIssuer({ issuer, jwks: { keys: [jwk] }, privateKey });
  }

  /** The issuer at `issuer` signing with a private key saved earlier with `privateJwk()`. */
  static async restore(issuer: string, privateJwk: JWK): Promise<LocalIssuer> {
    const privateKey = await importJWK(privateJwk, ALGORITHM, { extractable: true });
    if (privateKey instanceof Uint8Array) throw new Error('the saved local issuer key is not an RSA private key');
    return new LocalIssuer({ issuer, jwks: { keys: [publicJwkOf(privateJwk)] }, privateKey });
  }

  /** The private key as a JWK, for saving and restoring this issuer. */
  privateJwk(): Promise<JWK> {
    return exportJWK(this.#privateKey);
  }

  /** Mints an Access-shaped assertion for `email`, valid for `ttlSeconds` from `issuedAt`. */
  async mint(options: MintOptions): Promise<string> {
    const issuedAt = Math.floor((options.issuedAt ?? new Date()).getTime() / 1000);
    return new SignJWT({ email: options.email, type: 'app' })
      .setProtectedHeader({ alg: ALGORITHM, kid: KEY_ID })
      .setIssuer(this.issuer)
      .setAudience(audienceList(options.aud))
      .setSubject(crypto.randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + options.ttlSeconds)
      .sign(this.#privateKey);
  }
}
