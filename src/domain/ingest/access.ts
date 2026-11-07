/**
 * Access -- the admission rules checked before an Arrival's items are read
 * (design: Ingest, Admission). An Arrival is admitted only with an active
 * Client Key of the addressed Project.
 */

import { locateCredentials, type Credentials } from '../protocol/credentials.js';
import { isRefusal, refusal, type Refusal } from '../refusal.js';
import type { Arrival, ProjectConfig } from './arrival.js';

// --- predicates ---

function isActiveKey({ config, publicKey }: { config: ProjectConfig; publicKey: string }): boolean {
  return config.clientKeys.some((key) => key.active && key.publicKey === publicKey);
}

// --- exports ---

/** The Arrival's credentials when it may proceed; otherwise why not. An unknown Project reads as a disabled key. */
export function checkAccess({ arrival, config }: { arrival: Arrival; config: ProjectConfig | null }): Credentials | Refusal {
  const credentials = locateCredentials(arrival);
  if (isRefusal(credentials)) return credentials;
  if (config === null || !isActiveKey({ config, publicKey: credentials.publicKey })) return refusal('disabled-key');
  return credentials;
}
