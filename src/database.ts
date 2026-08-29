import { MemTable } from './memtable.js';
import type { LogFile } from './storage.js';
import type { LogRecord, Op } from './types.js';
import { WriteAheadLog } from './wal.js';

/**
 * Progress events emitted while the database works.
 *
 * These exist so that lessons and the REPL can narrate what is happening
 * without this file being full of console.log calls. The database does database
 * things; something else decides how to describe them.
 */
export type Step =
  | { kind: 'wal-begin'; op: Op; key: string; value?: string }
  | { kind: 'wal-done'; record: LogRecord }
  | { kind: 'mem-applied'; record: LogRecord }
  | { kind: 'replay-begin'; total: number }
  | { kind: 'replay-record'; record: LogRecord }
  | { kind: 'replay-done'; count: number };

export interface DatabaseOptions {
  onStep?: (step: Step) => void | Promise<void>;
}

/**
 * A key-value store with a write-ahead log in front of it.
 *
 * The entire point of this class is the ORDER of two lines inside `mutate()`.
 * Everything else -- the REPL, the lessons, the colours -- is scaffolding built
 * to make that ordering visible.
 */
export class Database {
  readonly wal: WriteAheadLog;
  private mem = new MemTable();
  private readonly onStep: (step: Step) => void | Promise<void>;

  constructor(file: LogFile, options: DatabaseOptions = {}) {
    this.wal = new WriteAheadLog(file);
    this.onStep = options.onStep ?? (() => {});
  }

  async set(key: string, value: string): Promise<LogRecord> {
    return this.mutate('SET', key, value);
  }

  async del(key: string): Promise<LogRecord> {
    return this.mutate('DEL', key);
  }

  /**
   * ===================================================================
   *  THE RULE. This is the whole idea, and it is four lines long.
   * ===================================================================
   *
   *   1. Write the intention to the log, and wait until it is durable.
   *   2. Only then change the in-memory state.
   *
   * "Write-ahead" is the name of that ordering: the log is written *ahead of*
   * the thing it describes. Swap these two steps and you still have a log, and
   * it still looks fine most of the time -- but you have lost the guarantee
   * that makes it worth having. Lesson 6 swaps them on purpose so you can watch
   * exactly what breaks.
   */
  private async mutate(op: Op, key: string, value?: string): Promise<LogRecord> {
    await this.onStep(
      value === undefined ? { kind: 'wal-begin', op, key } : { kind: 'wal-begin', op, key, value },
    );

    // STEP 1 -- durable first.
    const record = await this.wal.append(op, key, value);
    await this.onStep({ kind: 'wal-done', record });

    // STEP 2 -- volatile second. If we die between these two lines, the record
    // is already safely on disk and recovery will pick it up.
    this.mem.apply(record);
    await this.onStep({ kind: 'mem-applied', record });

    return record;
  }

  get(key: string): string | undefined {
    return this.mem.get(key);
  }

  entries(): Array<[string, string]> {
    return this.mem.entries();
  }

  /**
   * Simulate a crash.
   *
   * All this does is throw away memory. It does not touch the log file, because
   * a crash cannot un-write bytes that already reached the disk -- and that
   * asymmetry is precisely why the log is useful.
   */
  crash(): void {
    this.mem.wipe();
  }

  /**
   * Rebuild memory from the log, record by record, oldest to newest.
   *
   * Note there is no cleverness here: no "figure out what changed", no diffing.
   * We start from nothing and replay history. Because MemTable.apply is
   * deterministic, replaying the same log always lands on the same state --
   * which is what makes it safe to crash *during* recovery and just start over.
   */
  async recover(): Promise<LogRecord[]> {
    this.mem.wipe();

    const records = this.wal.readAll();
    await this.onStep({ kind: 'replay-begin', total: records.length });

    for (const record of records) {
      this.mem.apply(record);
      await this.onStep({ kind: 'replay-record', record });
    }

    await this.onStep({ kind: 'replay-done', count: records.length });
    return records;
  }

  /** Everything currently on disk. Used by narration to show the log. */
  logRecords(): LogRecord[] {
    return this.wal.readAll();
  }

  logPath(): string {
    return this.wal.path();
  }
}
