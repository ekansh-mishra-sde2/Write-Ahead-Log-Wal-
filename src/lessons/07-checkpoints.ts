import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../clock.js';
import { MemTable } from '../memtable.js';
import * as n from '../narrate.js';
import { LogFile } from '../storage.js';
import type { Lsn, LogRecord } from '../types.js';
import { DISK_WRITE_MS } from '../wal.js';
import type { Lesson } from './lesson.js';

/**
 * Lesson 2 ended on a claim we never paid for: "the log only ever grows."
 *
 * Taken literally that is a design that eventually fills the disk, and makes
 * every restart slower than the last. This lesson answers it.
 */

/** What we write alongside the log: the state, and how much log it covers. */
interface Snapshot {
  upToLsn: Lsn;
  state: Record<string, string>;
}

/**
 * `Database` plus checkpointing, kept here rather than in src/database.ts.
 *
 * Same reasoning as lesson 6's variants: src/database.ts stays the minimal
 * reference for the first six ideas, and anything a single lesson needs lives
 * with that lesson.
 */
class CheckpointingDatabase {
  private mem = new MemTable();
  private nextLsn: Lsn = 1;
  private powered = true;

  constructor(
    private readonly log: LogFile,
    private readonly snapshotPath: string,
  ) {}

  async set(key: string, value: string): Promise<void> {
    const record: LogRecord = { lsn: this.nextLsn++, op: 'SET', key, value };
    await sleep(DISK_WRITE_MS); // durable first, exactly as before
    if (!this.powered) return;
    this.log.appendLine(JSON.stringify(record));
    this.mem.apply(record);
  }

  /**
   * Take a checkpoint.
   *
   * ============================================================
   *  THE ORDERING RULE AGAIN, one level up. Lesson 6 all over.
   * ============================================================
   *
   *   1. Make the snapshot durable.
   *   2. Only then discard the log records it covers.
   *
   * Do it the other way round and there is a window where the records are gone
   * and the snapshot has not landed yet. Step 5 of this lesson crashes inside
   * that window.
   */
  async checkpoint(): Promise<{ upToLsn: Lsn; discarded: number }> {
    const upToLsn = this.nextLsn - 1;
    const snapshot: Snapshot = { upToLsn, state: Object.fromEntries(this.mem.entries()) };

    // STEP 1 -- the snapshot becomes durable.
    await sleep(DISK_WRITE_MS);
    if (!this.powered) return { upToLsn, discarded: 0 };
    fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

    // STEP 2 -- and only now is it safe to throw log records away.
    const before = this.records().length;
    this.truncateThrough(upToLsn);
    return { upToLsn, discarded: before - this.records().length };
  }

  /** ✘ The same checkpoint with the two steps swapped. Used only by step 5. */
  async brokenCheckpoint(): Promise<void> {
    const upToLsn = this.nextLsn - 1;
    const snapshot: Snapshot = { upToLsn, state: Object.fromEntries(this.mem.entries()) };

    this.truncateThrough(upToLsn); //  <-- 1. records destroyed immediately
    await sleep(DISK_WRITE_MS); //  <-- 2. snapshot durable eventually, maybe
    if (!this.powered) return;
    fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  }

  /**
   * Drop every record at or below `upToLsn` by rewriting the file.
   *
   * Note this is NOT a method on LogFile. That class deliberately offers no way
   * to modify the log, and lessons 2-6 lean on that being true. Truncation is a
   * privileged, once-in-a-while operation, so it lives here where it is
   * visible. (A real engine avoids the rewrite entirely: the log is split into
   * numbered segment files, and a checkpoint simply deletes whole segments.)
   */
  private truncateThrough(upToLsn: Lsn): void {
    const keep = this.records().filter((r) => r.lsn > upToLsn);
    const text = keep.map((r) => JSON.stringify(r)).join('\n');
    fs.writeFileSync(this.log.path(), keep.length ? text + '\n' : '', 'utf8');
  }

  /** Recovery, now in two parts: load the snapshot, then replay what follows. */
  async recover(): Promise<{ snapshotLsn: Lsn | null; loaded: number; replayed: number }> {
    this.mem.wipe();

    const snapshot = this.snapshot();
    let from: Lsn = 0;
    let loaded = 0;

    if (snapshot) {
      for (const [key, value] of Object.entries(snapshot.state)) {
        this.mem.apply({ lsn: snapshot.upToLsn, op: 'SET', key, value });
        loaded += 1;
      }
      from = snapshot.upToLsn;
    }

    const tail = this.records().filter((r) => r.lsn > from);
    for (const record of tail) this.mem.apply(record);

    return { snapshotLsn: snapshot ? snapshot.upToLsn : null, loaded, replayed: tail.length };
  }

  records(): LogRecord[] {
    return this.log.readAllLines().map((line) => JSON.parse(line) as LogRecord);
  }

  snapshot(): Snapshot | null {
    if (!fs.existsSync(this.snapshotPath)) return null;
    return JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8')) as Snapshot;
  }

  entries(): Array<[string, string]> {
    return this.mem.entries();
  }

  crash(): void {
    this.mem.wipe();
    this.powered = false;
  }

  reboot(): void {
    this.powered = true;
  }
}

// ---------------------------------------------------------------------------

const STOCK = ['apple', 'pear', 'plum'] as const;
const ROUNDS = 8;

function build(id: number): CheckpointingDatabase {
  const log = new LogFile(path.join(process.cwd(), 'data', `lesson-${id}.wal.log`));
  const snapshotPath = path.join(process.cwd(), 'data', `lesson-${id}.snapshot.json`);
  log.reset();
  if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath);
  return new CheckpointingDatabase(log, snapshotPath);
}

/** A busy little shop: three products, restocked over and over. */
async function runWorkload(db: CheckpointingDatabase, rounds = ROUNDS): Promise<void> {
  for (let round = 1; round <= rounds; round++) {
    for (const item of STOCK) {
      await db.set(`stock:${item}`, String(round * 10));
    }
  }
}

function snapshotPanel(db: CheckpointingDatabase): n.Panel {
  const snapshot = db.snapshot();
  return {
    title: 'SNAPSHOT',
    lines: snapshot
      ? [
          `covers everything up to lsn ${snapshot.upToLsn}`,
          '',
          ...Object.entries(snapshot.state).map(([k, v]) => `${k} = ${v}`),
        ]
      : ['(none yet)'],
  };
}

export const lesson: Lesson = {
  id: 7,
  title: 'Checkpoints',
  summary: 'Lesson 2 said the log only ever grows. That was a problem, not a feature.',

  async run() {
    n.resetSteps();

    // ------------------------------------------------------------------
    n.step('A shop restocks three products, eight times over.');
    const db = build(7);
    await runWorkload(db);

    const records = db.records();
    n.line(
      `  ${n.cyan('[WAL]')} ${n.bold(String(records.length))} records on disk` +
        `   ${n.magenta('[MEM]')} ${n.bold(String(db.entries().length))} keys in memory`,
    );
    n.showState(records.slice(-4), db.entries());
    n.note(`(showing the last 4 of ${records.length} records)`);
    n.note(
      `${records.length - db.entries().length} of those records describe values nobody will ever read again.`,
    );
    await n.beat(1400);

    // ------------------------------------------------------------------
    n.step('Crash, and count what recovery has to do.');
    db.crash();
    db.reboot();
    const cold = await db.recover();
    n.line(
      `  ${n.cyan('[WAL]')} replayed ${n.bold(String(cold.replayed))} records to rebuild ${n.bold(String(db.entries().length))} keys`,
    );
    n.note('It works — but the cost of a restart now depends on how long the shop has been open.');
    n.note('Run for a year and recovery replays a year. That is the bill lesson 2 left unpaid.');
    await n.beat(1600);

    // ------------------------------------------------------------------
    n.step('The fix: write down the current state, and note how much log it covers.');
    n.note('That file is a checkpoint. Everything it covers, the log no longer needs to keep.');
    await n.beat(1200);

    const result = await db.checkpoint();
    n.line(
      `  ${n.green('[SNAP]')} wrote snapshot covering lsn 1–${result.upToLsn}` +
        `   ${n.yellow(`discarded ${result.discarded} log records`)}`,
    );
    n.line();
    n.panels(snapshotPanel(db), n.diskPanel(db.records()));
    n.note('The log is empty now. Not lost — superseded. The snapshot says everything it said.');
    await n.beat(1600);

    // ------------------------------------------------------------------
    n.step('Keep trading, so there is a little history after the checkpoint.');
    await db.set('stock:apple', '95');
    await db.set('stock:pear', '96');
    n.line(`  ${n.cyan('[WAL]')} ${db.records().length} records since the checkpoint`);
    await n.beat();

    n.step('Crash again. Now watch how much less work recovery does.');
    db.crash();
    db.reboot();
    const warm = await db.recover();
    n.line(
      `  ${n.green('[SNAP]')} loaded ${warm.loaded} keys from the snapshot @ lsn ${warm.snapshotLsn}`,
    );
    n.line(`  ${n.cyan('[WAL]')} replayed only ${n.bold(String(warm.replayed))} records after it`);
    n.line();
    n.line(
      `  ${n.dim('before checkpointing:')} ${n.red(`${cold.replayed} records replayed`)}` +
        `    ${n.dim('after:')} ${n.green(`${warm.replayed} records replayed`)}`,
    );
    n.showState(db.records(), db.entries());
    n.note('Same state. Recovery time no longer grows with the age of the database.');
    await n.beat(1600);

    // ------------------------------------------------------------------
    n.step(`${n.red('One trap.')} A checkpoint is two writes, and their order matters.`);
    n.line();
    n.line(`  ${n.green('✔ right')}                            ${n.red('✘ wrong')}`);
    n.line(n.dim('    write the snapshot                  truncate the log'));
    n.line(n.dim('    truncate the log                    write the snapshot'));
    n.line();
    n.note('Truncate first and there is a window where the records are gone and');
    n.note('the snapshot has not landed. Crash in it and you have destroyed data.');
    await n.beat(1600);

    const doomed = build(70);
    await runWorkload(doomed, 3);
    const had = doomed.records().length;
    n.line(`  ${n.cyan('[WAL]')} ${had} records, ${doomed.entries().length} keys — all fine so far`);

    const broken = doomed.brokenCheckpoint();
    setTimeout(() => doomed.crash(), Math.floor(DISK_WRITE_MS / 2));
    await broken;
    n.crashBanner(
      'power cut between the truncate and the snapshot',
      '(this time the log file was NOT spared -- we deleted those records ourselves)',
    );

    doomed.reboot();
    const wreck = await doomed.recover();
    n.panels(snapshotPanel(doomed), n.memoryPanel(doomed.entries(), 'MEMORY (after restart)'));
    n.line(
      `  ${n.red(n.bold('Everything is gone.'))} ${had} records deleted, snapshot never written, ` +
        `${wreck.replayed} records left to replay.`,
    );
    n.note('The same mistake as lesson 6, one level up: something became unrecoverable');
    n.note('before the thing replacing it was durable.');
    await n.beat(1600);

    n.takeaway([
      `A checkpoint is a saved copy of the state plus ${n.bold('the LSN it covers')} — that number is what makes it usable.`,
      'It turns recovery from "replay all of history" into "load the snapshot, replay the tail". Restart time stops growing with the age of the database.',
      'Truncation is the only thing in this project that removes log records, and it removes only what the snapshot already accounts for. Nothing is ever actually lost.',
      `Order still rules: ${n.bold('snapshot durable first, truncate second')}. The same principle as lesson 6, applied one level up.`,
      'Real engines checkpoint on a timer or a size threshold, and delete whole log segments instead of rewriting a file — but the idea is exactly this.',
    ]);
  },
};
