// FakeIds -- Ids that count up from a prefix, so tests can predict them.
import type { Ids } from '../../src/ports/ids.js';

export class FakeIds implements Ids {
  private next = 1;

  constructor(private readonly prefix = 'id') {}

  newId(): string {
    const id = `${this.prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}
