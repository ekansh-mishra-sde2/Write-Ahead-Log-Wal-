import { Database } from '../database.js';
import * as n from '../narrate.js';
import { freshLog, type Lesson } from './lesson.js';
import fs from 'node:fs';

export const lesson: Lesson = {
  id: 2,
  title: 'The append-only log',
  summary: 'Write down what you are about to do, before you do it.',

  async run() {
    n.resetSteps();
    const file = freshLog(2);
    const db = new Database(file, { onStep: n.walNarrator() });

    n.step('Same three writes as lesson 1 — but now each one is logged first.');
    n.note(`the log lives at ${file.path().replace(process.cwd() + '/', '')}`);
    await n.beat();

    await db.set('user:1', 'alice');
    await db.set('user:2', 'bob');
    await db.set('cart:1', '3 items');
    await n.beat();

    n.step('This is the real file on your disk, byte for byte:');
    n.line();
    for (const raw of fs.readFileSync(file.path(), 'utf8').trimEnd().split('\n')) {
      n.line(n.dim('    ') + raw);
    }
    n.line();
    n.fileHint(file.path());
    await n.beat();

    n.step('Now change a value that already exists, and delete another one.');
    await db.set('user:1', 'alice.cooper');
    await db.del('user:2');
    await n.beat();

    n.step('Look at the file again. Nothing was edited. Nothing was removed.');
    n.line();
    for (const raw of fs.readFileSync(file.path(), 'utf8').trimEnd().split('\n')) {
      n.line(n.dim('    ') + raw);
    }
    n.line();
    n.note('lsn 1 still says alice, even though user:1 is now alice.cooper.');
    n.note('lsn 2 still says bob, even though user:2 no longer exists.');
    await n.beat();

    n.step('The log is history, not state. Memory is the state:');
    n.showState(db.logRecords(), db.entries());
    await n.beat();

    n.takeaway([
      `The log only ever ${n.bold('grows')}. Records are appended, never modified or deleted.`,
      'Appending is the cheapest and safest thing you can ask a disk to do — no seeking, no partial overwrite of good data.',
      'A record is a statement about the past ("at lsn 1 someone set user:1 to alice"). Past statements do not stop being true.',
      'Current state is derived by reading the log in order. Lesson 3 explains why that order is numbered.',
    ]);
  },
};
