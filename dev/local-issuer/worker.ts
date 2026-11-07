/**
 * The local issuer Worker (dev only; architecture Sign-in and Local
 * development): serves routes.ts over one LocalIssuer. Its key pair is
 * generated on first use and kept in the ISSUER_KEYS KV namespace, whose
 * local state lives in the checkout's .wrangler/state, so one checkout keeps
 * one issuer across restarts and nothing is shared between checkouts.
 */

import type { JWK } from 'jose';
import { LocalIssuer } from './local-issuer.js';
import { issuerAnswer } from './routes.js';

/** The part of the KV binding this Worker uses. */
type KeyStore = { get(key: string, type: 'json'): Promise<unknown>; put(key: string, value: string): Promise<void> };

type IssuerEnv = { readonly ISSUER_KEYS: KeyStore; readonly ISSUER_URL: string };

const PRIVATE_KEY = 'private-jwk';

let issuer: Promise<LocalIssuer> | null = null;

// --- flow ---

async function loadOrCreate(env: IssuerEnv): Promise<LocalIssuer> {
  const saved = (await env.ISSUER_KEYS.get(PRIVATE_KEY, 'json')) as JWK | null;
  if (saved) return LocalIssuer.restore(env.ISSUER_URL, saved);
  const created = await LocalIssuer.create(env.ISSUER_URL);
  await env.ISSUER_KEYS.put(PRIVATE_KEY, JSON.stringify(await created.privateJwk()));
  return created;
}

// --- exports ---

export default {
  async fetch(request: Request, env: IssuerEnv): Promise<Response> {
    issuer ??= loadOrCreate(env);
    return issuerAnswer(request, { issuer: await issuer, now: new Date() });
  },
};
