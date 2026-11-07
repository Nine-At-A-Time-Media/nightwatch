/**
 * TokenCache -- where the github adapter keeps installation tokens until
 * shortly before they expire (architecture Mechanism, Code and GitHub: KV in
 * production). The in-memory cache here serves tests and the local stage;
 * a KV-backed one implements the same interface. Times are epoch
 * milliseconds.
 */

/** An installation access token and when GitHub says it expires. */
export type InstallationToken = { readonly token: string; readonly expiresAt: number };

export interface TokenCache {
  get(key: string): Promise<InstallationToken | null>;
  put(key: string, token: InstallationToken): Promise<void>;
}

export class MemoryTokenCache implements TokenCache {
  readonly #tokens = new Map<string, InstallationToken>();

  async get(key: string): Promise<InstallationToken | null> {
    return this.#tokens.get(key) ?? null;
  }

  async put(key: string, token: InstallationToken): Promise<void> {
    this.#tokens.set(key, token);
  }
}
