/**
 * FakeIds -- seeded Ids: `<prefix>-1`, `<prefix>-2`, ... in order. Random
 * bytes are a counter spread over the asked length, so each draw differs;
 * a Report Reference hashes to `hash:` and its characters reversed, which is
 * stable, distinct per reference, and does not contain the reference.
 */

import type { Ids } from '../../src/ports/ids.js';

export class FakeIds implements Ids {
  readonly #prefix: string;
  #next = 1;
  #draws = 0;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  newId(): string {
    return `${this.#prefix}-${this.#next++}`;
  }

  randomBytes(count: number): Uint8Array {
    this.#draws += 1;
    return Uint8Array.from({ length: count }, (_, i) => (this.#draws * 31 + i * 7) & 0xff);
  }

  async hashReference(reference: string): Promise<string> {
    return `hash:${[...reference].reverse().join('')}`;
  }
}
