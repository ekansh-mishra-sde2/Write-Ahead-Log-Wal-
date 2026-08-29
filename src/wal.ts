import { sleep } from './clock.js';
import type { LogFile } from './storage.js';
import type { LogRecord, Lsn, Op } from './types.js';

/**
 * How long we pretend a durable write to disk takes.
 *
 * IMPORTANT, because this is the one dishonest line in the project: this delay
 * is *pedagogical*, not real. A genuine WAL would call fsync() and actually
 * wait for the drive to confirm the bytes are on stable storage. We just take a
 * nap. The nap exists for two reasons:
 *
 *   1. So you can feel that durability costs something. Every SET pays 40ms.
 *   2. So there is a visible window between "logged" and "applied" -- which is
 *      exactly the window lesson 6 crashes inside of.
 */
export const DISK_WRITE_MS = 40;

/**
 * The log itself.
 *
 * Notice what is missing from this class: there is no `update`, no `delete`,
 * no `rewrite`. You cannot change a record once it is written, because the API
 * gives you no way to. That is what "append-only" means, and enforcing it in
 * the type signature is more convincing than a comment saying "please don't".
 */
export class WriteAheadLog {
  private nextLsn: Lsn = 1;

  constructor(private readonly file: LogFile) {
    // Restarting? Pick up numbering where the existing log left off, so LSNs
    // are never reused across runs.
    const existing = this.readAll();
    const last = existing[existing.length - 1];
    if (last) this.nextLsn = last.lsn + 1;
  }

  /** Append one record and wait for it to be "durable". */
  async append(op: Op, key: string, value?: string): Promise<LogRecord> {
    const record: LogRecord =
      value === undefined
        ? { lsn: this.nextLsn++, op, key }
        : { lsn: this.nextLsn++, op, key, value };

    await sleep(DISK_WRITE_MS); // <- the pretend cost of durability
    this.file.appendLine(JSON.stringify(record));

    return record;
  }

  /** Every record ever written, oldest first. This is what replay reads. */
  readAll(): LogRecord[] {
    return this.file.readAllLines().map((line) => JSON.parse(line) as LogRecord);
  }

  /** The LSN the next append would get. Handy for narration. */
  peekNextLsn(): Lsn {
    return this.nextLsn;
  }

  path(): string {
    return this.file.path();
  }
}
