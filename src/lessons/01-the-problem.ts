import { MemTable } from '../memtable.js';
import * as n from '../narrate.js';
import type { Lesson } from './lesson.js';

/**
 * Before we build anything, feel the problem. There is no WAL in this lesson at
 * all -- just data in RAM, and then no data in RAM.
 */
export const lesson: Lesson = {
  id: 1,
  title: 'The problem',
  summary: 'Memory is fast, and memory is a liar. Watch some data die.',

  async run() {
    n.resetSteps();

    n.step('Start a database that keeps everything in memory. No log, no files.');
    const mem = new MemTable();
    await n.beat();

    n.step('Write three values. Each one is instant — nothing touches a disk.');
    for (const [key, value] of [
      ['user:1', 'alice'],
      ['user:2', 'bob'],
      ['cart:1', '3 items'],
    ] as Array<[string, string]>) {
      mem.apply({ lsn: 0, op: 'SET', key, value });
      n.line(`  ${n.magenta('[MEM]')} ${key} = ${value}`);
      await n.sleep(220);
    }
    await n.beat();

    n.step('Here is the state. Note that the DISK side has nothing in it at all.');
    n.showState([], mem.entries());
    await n.beat();

    n.step('Now the power goes out. Or the process is OOM-killed. Or a bug throws.');
    await n.beat(900);
    mem.wipe();
    n.crashBanner('the whole memtable evaporated');
    await n.beat();

    n.step('The machine comes back up. Everything we can find is:');
    n.showState([], mem.entries());
    await n.beat();

    n.takeaway([
      'RAM does not survive a crash, and a crash needs no permission from you.',
      'A write your users believe succeeded, but which only ever existed in RAM, is a write you will eventually lose.',
      `To survive, something must reach ${n.bold('durable storage')} before you tell anyone the write worked.`,
      'That something is the write-ahead log. Lesson 2 builds it.',
    ]);
  },
};
