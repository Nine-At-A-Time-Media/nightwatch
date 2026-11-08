/**
 * Signer -- the seam for keyed signatures (architecture Mechanism, Alerts
 * and notifications: the Reply-To token naming an Issue and its recipient
 * Member). HMAC under a Worker secret through Web Crypto in production, a
 * fake in tests. A signature is URL-safe text and verifies only for the
 * text it was made for.
 */

export interface Signer {
  sign(text: string): Promise<string>;
  verify(signed: { text: string; signature: string }): Promise<boolean>;
}
