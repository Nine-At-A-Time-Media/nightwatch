/**
 * Access -- the admission rules checked before an Arrival's items are read
 * (design: Ingest, Admission). An Arrival is admitted only with an active
 * Client Key of the addressed Project, from an allowed origin when the
 * Project restricts origins. An allowed origin may be a glob; '*' admits any.
 */

import { locateCredentials, type Credentials } from '../protocol/credentials.js';
import { isRefusal, refusal, type Refusal } from '../refusal.js';
import type { Arrival, ProjectConfig } from './arrival.js';
import { globMatches } from './inbound-filters.js';

// --- predicates ---

function isActiveKey({ config, publicKey }: { config: ProjectConfig; publicKey: string }): boolean {
  return config.clientKeys.some((key) => key.active && key.publicKey === publicKey);
}

/** A server SDK sends no origin and is not subject to origin restriction. */
function isAllowedOrigin({ config, origin }: { config: ProjectConfig; origin: string | null }): boolean {
  return origin === null || config.allowedOrigins.some((pattern) => globMatches({ pattern, text: origin, ignoreCase: true }));
}

// --- exports ---

/** An Arrival allowed to proceed: the credentials it presented and its Project's config. */
export type Access = { readonly credentials: Credentials; readonly config: ProjectConfig };

/** Whether the Arrival may proceed, and if not why. An unknown Project reads as a disabled key. */
export function checkAccess({ arrival, config }: { arrival: Arrival; config: ProjectConfig | null }): Access | Refusal {
  const credentials = locateCredentials(arrival);
  if (isRefusal(credentials)) return credentials;
  if (config === null || !isActiveKey({ config, publicKey: credentials.publicKey })) return refusal('disabled-key');
  if (!isAllowedOrigin({ config, origin: arrival.origin })) return refusal('origin-not-allowed');
  return { credentials, config };
}
