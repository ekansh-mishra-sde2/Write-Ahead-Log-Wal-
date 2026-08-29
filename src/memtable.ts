import type { LogRecord } from './types.js';

/**
 * The volatile half of the database: plain data in RAM.
 *
 * This is the part that dies in a crash. It holds no truth of its own -- every
 * value in here got here by having a log record applied to it, which is why
 * `apply()` is the only way to change it.
 */
export class MemTable {
  private map = new Map<string, string>();

  /**
   * Fold one log record into the current state.
   *
   * This single method is used for BOTH live writes and crash recovery. That is
   * not a coincidence or an optimization -- it is the reason replay works.
   * Recovery is not special-case code; it is just the normal write path, run
   * again over records we already have.
   */
  apply(record: LogRecord): void {
    switch (record.op) {
      case 'SET':
        this.map.set(record.key, record.value ?? '');
        break;
      case 'DEL':
        this.map.delete(record.key);
        break;
    }
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  entries(): Array<[string, string]> {
    return [...this.map.entries()];
  }

  size(): number {
    return this.map.size;
  }

  /** What a crash does. Instant, total, and it takes no arguments. */
  wipe(): void {
    this.map = new Map();
  }
}
