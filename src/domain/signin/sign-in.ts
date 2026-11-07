/**
 * Sign-in -- a verified assertion of a person's email address by an issuer
 * the Organization trusts (design Domain Language; Tenancy and access, Sign-in
 * and Trusted sign-in). Pure rules over an assertion's claims, applied after
 * its signature has been checked. Without a Sign-in a request identifies
 * nobody.
 */

import { refusal, type Refusal } from '../refusal.js';

export type SignIn = {
  readonly email: string;
  readonly issuer: string;
  readonly audience: string;
  readonly expiresAt: Date;
};

/** An issuer the Organization trusts, and the audiences (applications) it is trusted for. */
export type TrustedIssuer = {
  readonly issuer: string;
  readonly audiences: readonly string[];
};

/** The claims of an assertion whose signature has been checked; nothing in it is trusted yet. */
export type AssertionClaims = Readonly<Record<string, unknown>>;

// --- predicates ---

function isAddress(email: string): boolean {
  return email.includes('@');
}

function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

// --- helpers ---

function audiencesOf(aud: unknown): readonly string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function expiryOf(exp: unknown): Date | null {
  return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000) : null;
}

function emailOf(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return isAddress(normalized) ? normalized : null;
}

// --- exports ---

/** The trusted issuer an assertion's issuer names, or null when the Organization trusts no such issuer. */
export function trustedIssuerFor(issuer: unknown, trusted: readonly TrustedIssuer[]): TrustedIssuer | null {
  return trusted.find((candidate) => candidate.issuer === issuer) ?? null;
}

/** Applies the Trusted sign-in rules to a signature-checked assertion's claims. */
export function checkClaims(claims: AssertionClaims, trusted: readonly TrustedIssuer[], now: Date): SignIn | Refusal {
  const issuer = trustedIssuerFor(claims['iss'], trusted);
  if (!issuer) return refusal('untrusted-issuer');
  const audience = audiencesOf(claims['aud']).find((aud) => issuer.audiences.includes(aud));
  if (audience === undefined) return refusal('wrong-audience');
  const expiresAt = expiryOf(claims['exp']);
  if (!expiresAt || isExpired(expiresAt, now)) return refusal('expired');
  const email = emailOf(claims['email']);
  if (!email) return refusal('missing-email');
  return { email, issuer: issuer.issuer, audience, expiresAt };
}
