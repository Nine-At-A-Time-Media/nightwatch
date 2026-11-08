/**
 * DSN -- the address an SDK is configured with. Pure parsing and formatting;
 * the legacy secret part is accepted and ignored.
 */

import { refusal, type Refusal } from '../refusal.js';

export type Dsn = {
  readonly scheme: string;
  readonly publicKey: string;
  readonly host: string;
  readonly path: string;
  readonly projectId: string;
};

const DSN_PATTERN = /^(https?):\/\/([^:@/]+)(?::[^@/]*)?@([^/]+)((?:\/[^/]+)*)\/(\d+)\/?$/;

export function parseDsn(text: string): Dsn | Refusal {
  const [, scheme, publicKey, host, path, projectId] = DSN_PATTERN.exec(text.trim()) ?? [];
  if (!scheme || !publicKey || !host || !projectId) return refusal('malformed-dsn');
  return { scheme, publicKey, host, path: path ?? '', projectId };
}

export function formatDsn(dsn: Dsn): string {
  return `${dsn.scheme}://${dsn.publicKey}@${dsn.host}${dsn.path}/${dsn.projectId}`;
}
