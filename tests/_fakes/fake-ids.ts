/**
 * FakeIds -- seeded Ids: `<prefix>-1`, `<prefix>-2`, ... in order.
 */

import type { Ids } from '../../src/ports/ids.js';

export class FakeIds implements Ids {
  readonly #prefix: string;
  #next = 1;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  newId(): string {
    return `${this.#prefix}-${this.#next++}`;
  }
}
