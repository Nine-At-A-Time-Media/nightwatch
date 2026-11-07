/**
 * KvTokenCache -- the github adapter's TokenCache over a KV namespace
 * (architecture Mechanism, Code and GitHub: installation tokens are cached in
 * KV until shortly before expiry). Each token is one JSON entry under its
 * key, set to expire with the token, so KV drops it by itself; an entry KV
 * cannot read back as a token is a miss, and the adapter mints afresh.
 */

import { z } from 'zod';
import type { InstallationToken, TokenCache } from '../github/token-cache.js';

const PREFIX = 'github-installation-token:';
/** KV's shortest expiration TTL, in seconds. */
const MINIMUM_TTL_SECONDS = 60;

const TokenEntry = z.object({ token: z.string(), expiresAt: z.number() });

// --- helpers ---

/** Seconds until the token expires, never below KV's minimum. */
export function ttlSecondsOf({ expiresAt, now }: { expiresAt: number; now: number }): number {
  return Math.max(MINIMUM_TTL_SECONDS, Math.ceil((expiresAt - now) / 1000));
}

// --- adapter ---

export class KvTokenCache implements TokenCache {
  readonly #kv: KVNamespace;
  readonly #now: () => number;

  constructor({ kv, now }: { kv: KVNamespace; now: () => number }) {
    this.#kv = kv;
    this.#now = now;
  }

  async get(key: string): Promise<InstallationToken | null> {
    const parsed = TokenEntry.safeParse(await this.#kv.get(`${PREFIX}${key}`, 'json'));
    return parsed.success ? parsed.data : null;
  }

  async put(key: string, token: InstallationToken): Promise<void> {
    await this.#kv.put(`${PREFIX}${key}`, JSON.stringify(token), {
      expirationTtl: ttlSecondsOf({ expiresAt: token.expiresAt, now: this.#now() }),
    });
  }
}
