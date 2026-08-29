import { Database } from '../database.js';
import * as n from '../narrate.js';
import { freshLog, type Lesson } from './lesson.js';

/** The payoff lesson. Lesson 1's disaster, survived. */
export const lesson: Lesson = {
  id: 4,
  title: 'Crash and replay',
  summary: 'The same crash as lesson 1 — but this time we get the data back.',

  async run() {
    n.resetSteps();
    const file = freshLog(4);
    const db = new Database(file, { onStep: n.walNarrator() });

    n.step('Write the same three values from lesson 1, through the WAL this time.');
    await db.set('user:1', 'alice');
    await db.set('user:2', 'bob');
    await db.set('cart:1', '3 items');
    await n.beat();

    n.step('Both sides now hold the same truth — one durable, one fast.');
    n.showState(db.logRecords(), db.entries());
    await n.beat();

    n.step('Crash. Exactly the same crash that destroyed everything in lesson 1.');
    await n.beat(900);
    db.crash();
    n.crashBanner('memtable wiped, process "restarted"');
    await n.beat();

    n.step('Memory is empty. But look at what the crash could not touch:');
    n.showState(db.logRecords(), db.entries());
    n.note('The disk side is untouched. That asymmetry is the entire safety net.');
    await n.beat(1000);

    n.step('Recovery: throw memory away and replay the log from lsn 1.');
    await db.recover();
    await n.beat();

    n.step('State restored, derived entirely from the file on disk.');
    n.showState(db.logRecords(), db.entries());
    await n.beat();

    n.takeaway([
      `Recovery is not a repair. It is a ${n.bold('rebuild')} — start empty, apply every record in order.`,
      'The replay code path is the same MemTable.apply() used by live writes. There is no separate "recovery mode" to get wrong.',
      'Anything the log recorded survives. Anything it did not record is gone — which is why we log first.',
      'Try it yourself: npm run repl, then SET / CRASH / RECOVER.',
    ]);
  },
};
