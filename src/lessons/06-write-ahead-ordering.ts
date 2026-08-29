import { sleep } from '../clock.js';
import { MemTable } from '../memtable.js';
import * as n from '../narrate.js';
import type { LogFile } from '../storage.js';
import type { LogRecord } from '../types.js';
import { DISK_WRITE_MS } from '../wal.js';
import { freshLog, type Lesson } from './lesson.js';

/**
 * Two databases that differ by exactly two lines, in exactly one respect:
 * which of "log it" and "apply it" happens first.
 *
 * Both are spelled out here rather than reusing src/database.ts, so you can
 * read them side by side. src/database.ts stays the single correct reference;
 * the broken variant never escapes this file.
 */

/** Shared plumbing, so the two variants differ ONLY in their ordering. */
abstract class Variant {
  protected mem = new MemTable();
  protected nextLsn = 1;
  /** Once false, bytes can no longer reach the platter. This is the crash. */
  private powered = true;

  constructor(protected readonly file: LogFile) {}

  abstract set(key: string, value: string): Promise<void>;

  /** Model the durable write: slow, and useless if the power is already gone. */
  protected async writeToDisk(record: LogRecord): Promise<void> {
    await sleep(DISK_WRITE_MS);
    if (!this.powered) return; // died mid-write; the bytes never landed
    this.file.appendLine(JSON.stringify(record));
  }

  /** Pull the plug: memory dies instantly, any in-flight disk write is lost. */
  cutPower(): void {
    this.powered = false;
    this.mem.wipe();
  }

  read(key: string): string | undefined {
    return this.mem.get(key);
  }

  logRecords(): LogRecord[] {
    return this.file.readAllLines().map((l) => JSON.parse(l) as LogRecord);
  }

  /** What a restarted process would rebuild from the log. */
  recovered(): Array<[string, string]> {
    const mem = new MemTable();
    for (const record of this.logRecords()) mem.apply(record);
    return mem.entries();
  }
}

/** ✘ WRONG: change memory first, log afterwards. */
class WriteBehind extends Variant {
  async set(key: string, value: string): Promise<void> {
    const record: LogRecord = { lsn: this.nextLsn++, op: 'SET', key, value };
    this.mem.apply(record); //  <-- 1. visible to readers immediately
    await this.writeToDisk(record); //  <-- 2. durable eventually, maybe
  }
}

/** ✔ RIGHT: log first, and only then change memory. */
class WriteAhead extends Variant {
  async set(key: string, value: string): Promise<void> {
    const record: LogRecord = { lsn: this.nextLsn++, op: 'SET', key, value };
    await this.writeToDisk(record); //  <-- 1. durable first
    this.mem.apply(record); //  <-- 2. only now is it visible to readers
  }
}

const CRASH_AT_MS = 20; // half way through the 40ms disk write
const OBSERVE_AT_MS = 15; // a reader shows up just before the lights go out

/**
 * Run the experiment with NO narration inside it.
 *
 * This matters: narration pauses are hundreds of milliseconds long, and the
 * whole experiment is over in 40ms. If we stopped to explain things mid-write,
 * the disk write would finish before the "crash" ever arrived and the
 * demonstration would quietly prove nothing. So we take our measurements
 * first, at real speed, and talk about them afterwards.
 */
async function crashMidWrite(db: Variant): Promise<{ readDuringWrite: string | undefined }> {
  const write = db.set('order:9', 'confirmed');
  const crash = new Promise<void>((resolve) =>
    setTimeout(() => {
      db.cutPower();
      resolve();
    }, CRASH_AT_MS),
  );

  await sleep(OBSERVE_AT_MS);
  const readDuringWrite = db.read('order:9'); // observed while the disk is busy

  await crash;
  await write;
  return { readDuringWrite };
}

function reportRead(value: string | undefined): void {
  n.line(
    value === undefined
      ? `        a reader asking for order:9 got ${n.dim('(nil)')}`
      : `        a reader asking for order:9 got ${n.bold(n.green(value))}`,
  );
}

function afterRestart(db: Variant): void {
  n.panels(n.diskPanel(db.logRecords()), n.memoryPanel(db.recovered(), 'MEMORY (after restart)'));
}

export const lesson: Lesson = {
  id: 6,
  title: 'Why "write-ahead"',
  summary: 'Swap two lines, crash mid-write, and watch a confirmed order disappear.',

  async run() {
    n.resetSteps();

    n.line(`  ${n.red('✘ WriteBehind')}                        ${n.green('✔ WriteAhead')}`);
    n.line(n.dim('    mem.apply(record)                    await writeToDisk(record)'));
    n.line(n.dim('    await writeToDisk(record)            mem.apply(record)'));
    n.line();
    n.note(
      `Two lines, swapped. A disk write takes ${DISK_WRITE_MS}ms; a reader looks at ${OBSERVE_AT_MS}ms; the power dies at ${CRASH_AT_MS}ms.`,
    );
    await n.beat(1400);

    // ------------------------------------------------------------------
    n.step(`${n.red('WriteBehind')} — memory first. Running the experiment…`);
    const wrong = new WriteBehind(freshLog(60));
    const wrongResult = await crashMidWrite(wrong);
    await n.beat(600);

    n.line(`        ${n.dim(`${OBSERVE_AT_MS}ms in, disk still writing:`)}`);
    reportRead(wrongResult.readDuringWrite);
    n.note('Memory was updated first, so that value was already being served.');
    await n.beat(1200);

    n.crashBanner(`power cut at ${CRASH_AT_MS}ms; those bytes never reached the disk`);

    n.step('Restart, replay the log, and go looking for that order:');
    afterRestart(wrong);
    n.line(
      `  ${n.red(n.bold('order:9 is gone.'))} We told a reader "confirmed", and now it never existed.`,
    );
    n.note('That is not a lost write. That is a lie we already told.');
    await n.beat(1800);

    // ------------------------------------------------------------------
    n.step(`${n.green('WriteAhead')} — log first. Same write, same crash, same millisecond.`);
    const right = new WriteAhead(freshLog(61));
    const rightResult = await crashMidWrite(right);
    await n.beat(600);

    n.line(`        ${n.dim(`${OBSERVE_AT_MS}ms in, disk still writing:`)}`);
    reportRead(rightResult.readDuringWrite);
    n.note('Nothing to see. We do not show a write we have not made durable yet.');
    await n.beat(1200);

    n.crashBanner(`power cut at ${CRASH_AT_MS}ms, exactly as before`);

    n.step('Restart and replay. The order is missing here too — but honestly.');
    afterRestart(right);
    n.line(`  ${n.green(n.bold('Nobody was ever told this order existed.'))}`);
    n.note('Nothing was lost. A write simply did not happen, and everyone agrees on that.');
    await n.beat(1800);

    // ------------------------------------------------------------------
    n.step('Finally: let the disk write finish, and only then crash.');
    const durable = new WriteAhead(freshLog(62));
    await durable.set('order:9', 'confirmed');
    reportRead(durable.read('order:9'));
    n.note('Readable — which, under this ordering, means it is already on disk.');
    await n.beat();

    durable.cutPower();
    n.crashBanner('crashed after the write completed');
    afterRestart(durable);
    n.line(`  ${n.green(n.bold('order:9 survived.'))}`);
    await n.beat();

    n.takeaway([
      `Both orderings keep a log. Only one keeps a ${n.bold('promise')}.`,
      'Write-behind lets a value become readable before it is durable. Every crash inside that window destroys data someone has already seen.',
      `Write-ahead makes durability the precondition for visibility: ${n.bold('if you could read it, you can recover it')}.`,
      'That is the whole meaning of the name — the log is written ahead of the change it describes.',
      `It is also why writes cost something. Those ${DISK_WRITE_MS}ms are not overhead to optimise away; they are the guarantee you are buying.`,
    ]);
  },
};
