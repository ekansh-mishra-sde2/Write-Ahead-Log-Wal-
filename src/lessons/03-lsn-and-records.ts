import { Database } from '../database.js';
import * as n from '../narrate.js';
import { WriteAheadLog } from '../wal.js';
import { freshLog, type Lesson } from './lesson.js';

const SAMPLE = '{"lsn":1,"op":"SET","key":"user:1","value":"alice"}';

/**
 * Draw callout lines under specific columns of `text`.
 *
 * Doing this by arithmetic rather than by hand-counting spaces means the
 * pointers cannot drift out of alignment when the sample record is edited.
 */
function annotate(text: string, marks: Array<[column: number, label: string]>): void {
  const indent = '    ';
  n.line(indent + n.dim(text));

  const columns = marks.map(([column]) => column);
  const rail = (upTo: number): string => {
    const chars = Array.from({ length: Math.max(...columns) + 1 }, () => ' ');
    for (const column of columns) if (column < upTo) chars[column] = '│';
    return chars.join('').slice(0, upTo);
  };

  n.line(indent + n.dim(rail(Math.max(...columns) + 1)));
  for (const [column, label] of [...marks].reverse()) {
    n.line(indent + n.dim(rail(column)) + n.dim('└─ ') + label);
  }
}

export const lesson: Lesson = {
  id: 3,
  title: 'LSNs and the record format',
  summary: 'Why every line in the log carries a number.',

  async run() {
    n.resetSteps();
    const file = freshLog(3);
    const db = new Database(file, { onStep: n.walNarrator() });

    n.step('Anatomy of a single record. Four fields, and that is the entire format.');
    n.line();
    annotate(SAMPLE, [
      [7, 'log sequence number: where this sits in history'],
      [16, 'what happened: SET or DEL'],
      [30, 'which key'],
      [46, 'the new value'],
    ]);
    n.line();
    await n.beat(1200);

    n.step('LSNs are assigned in order, and they only ever go up.');
    await db.set('a', '1');
    await db.set('b', '2');
    await db.del('a');
    await db.set('c', '3');
    await n.beat();

    n.showState(db.logRecords(), db.entries());
    n.note('lsn 3 deletes "a". Because it comes after lsn 1, it wins.');
    n.note('Reverse those two lines and the final state changes. Order IS the data.');
    await n.beat(1200);

    n.step('An LSN also tells a restarting process where history left off.');
    const reopened = new WriteAheadLog(file);
    n.line(`  ${n.cyan('[WAL]')} reopened the same file; next LSN would be ${n.bold(String(reopened.peekNextLsn()))}`);
    n.note('It read the last line, saw lsn 4, and continues at 5 — no number is ever reused.');
    await n.beat();

    n.takeaway([
      `An LSN is a ${n.bold('position in history')}, not a timestamp and not an id you chose.`,
      'Monotonic numbering means "later" is decidable by comparison, with no clocks involved.',
      'Replaying in LSN order is what makes a later write correctly overwrite an earlier one.',
      'It also gives recovery a bookmark: everything up to lsn N is accounted for.',
    ]);
  },
};
