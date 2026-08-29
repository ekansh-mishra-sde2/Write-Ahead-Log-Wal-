import { Database } from '../database.js';
import * as n from '../narrate.js';
import { freshLog, type Lesson } from './lesson.js';

export const lesson: Lesson = {
  id: 5,
  title: 'Replay is idempotent',
  summary: 'Recovery you can safely interrupt, and safely repeat.',

  async run() {
    n.resetSteps();
    const file = freshLog(5);
    const db = new Database(file, { onStep: n.walNarrator() });

    n.step('Build a log with an overwrite and a delete in it, so order matters.');
    await db.set('user:1', 'alice');
    await db.set('user:2', 'bob');
    await db.set('user:1', 'alice.cooper');
    await db.del('user:2');
    await n.beat();

    n.step('Replay it three times in a row and compare the results.');
    const results: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      n.line(`  ${n.dim(`— replay #${attempt} —`)}`);
      await db.recover();
      const snapshot = JSON.stringify(db.entries());
      results.push(snapshot);
      n.line(`  ${n.magenta('[MEM]')} ${snapshot}`);
      await n.sleep(400);
    }
    n.line();

    const allEqual = results.every((r) => r === results[0]);
    n.line(
      allEqual
        ? `  ${n.green('✔ identical every time')}`
        : `  ${n.red('✘ results differed — that would be a bug')}`,
    );
    await n.beat();

    n.step('Now the case that actually matters: crash in the MIDDLE of recovery.');
    await n.beat();
    db.crash();
    n.line(`  ${n.cyan('[WAL]')} replaying… applied lsn 1, applied lsn 2…`);
    await n.sleep(600);
    db.crash();
    n.crashBanner('died halfway through recovery, with memory half-rebuilt');
    await n.beat();

    n.step('No special handling. Wipe, and just start the replay over from lsn 1.');
    await db.recover();
    n.showState(db.logRecords(), db.entries());
    await n.beat();

    n.takeaway([
      `Applying the same log twice gives the same state as applying it once. That property is called ${n.bold('idempotence')}.`,
      'It comes from the records being absolute ("set user:1 to alice"), not relative ("increment user:1"). Relative records would double-count.',
      'Because replay is idempotent, a crash during recovery costs you time and nothing else — retry from the beginning.',
      'This is why recovery needs no bookkeeping of its own: no "how far did I get last time" file to keep consistent.',
    ]);
  },
};
