/**
 * RandomIds -- Ids from the Workers runtime's cryptographic random source.
 */

import type { Ids } from '../../ports/ids.js';

export class RandomIds implements Ids {
  newId(): string {
    return crypto.randomUUID().replaceAll('-', '');
  }
}
