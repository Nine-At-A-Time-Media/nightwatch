/**
 * RandomIds -- Ids from the Workers runtime's Web Crypto: random ids and
 * bytes from its cryptographic random source, Report Reference and content
 * hashes as SHA-256 written in lowercase hex.
 */

import type { ReportReference } from '../../domain/report/reference.js';
import type { Ids } from '../../ports/ids.js';

// --- helpers ---

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// --- exports ---

export class RandomIds implements Ids {
  newId(): string {
    return crypto.randomUUID().replaceAll('-', '');
  }

  randomBytes(count: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(count));
  }

  async hashReference(reference: ReportReference): Promise<string> {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reference)));
  }

  // --- task-022: content hashing (Artifact keys, Access Token hashes) ---

  async hashContent(bytes: Uint8Array): Promise<string> {
    return hex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  }
}
