/**
 * FakeSignInVerifier -- an in-memory SignInVerifier for use-case tests. A
 * table maps assertion strings to the Sign-in each asserts; an assertion not
 * in the table is unverified. A known assertion still passes through the
 * domain's Trusted sign-in rules, so issuer, audience, expiry and email are
 * judged exactly as the real adapter judges them.
 */

import { refusal, type Refusal } from '../../src/domain/refusal.js';
import { checkClaims, type SignIn, type TrustedIssuer } from '../../src/domain/signin/sign-in.js';
import type { SignInVerifier } from '../../src/ports/sign-in-verifier.js';

export class FakeSignInVerifier implements SignInVerifier {
  readonly #table: Map<string, SignIn>;
  readonly #clock: { now(): Date };

  /** `table` maps an assertion string to the Sign-in it asserts; `clock` decides expiry. */
  constructor(options: { table?: Readonly<Record<string, SignIn>>; clock: { now(): Date } }) {
    this.#table = new Map(Object.entries(options.table ?? {}));
    this.#clock = options.clock;
  }

  /** Adds an assertion to the table. */
  register(assertion: string, signIn: SignIn): void {
    this.#table.set(assertion, signIn);
  }

  async verify(assertion: string, trusted: readonly TrustedIssuer[]): Promise<SignIn | Refusal> {
    const signIn = this.#table.get(assertion);
    if (!signIn) return refusal('unverified-sign-in');
    const claims = { iss: signIn.issuer, aud: [signIn.audience], email: signIn.email, exp: signIn.expiresAt.getTime() / 1000 };
    return checkClaims(claims, trusted, this.#clock.now());
  }
}
