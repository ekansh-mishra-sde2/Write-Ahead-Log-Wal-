import readline from 'node:readline/promises';
import { runOne, wantsFast } from './lesson-runner.js';
import { lessons } from './lessons/index.js';
import * as n from './narrate.js';
import { startRepl } from './repl.js';

/**
 * `npm start` — the guided walkthrough.
 *
 * Runs the lessons one at a time and stops between each one, so you set the
 * pace rather than the program. At every break you can move on, replay the
 * lesson you just watched, or quit. At the end it offers to drop you straight
 * into the sandbox.
 *
 * When stdin is not a terminal (piped input, CI) there is nobody to press a
 * key, so it plays straight through instead of hanging on a prompt.
 */

const interactive = process.stdin.isTTY === true;

function welcome(): void {
  n.line();
  n.line(n.cyan('  ┌────────────────────────────────────────────────────────┐'));
  n.line(n.cyan('  │') + n.bold('           Write-Ahead Logging, by example              ') + n.cyan('│'));
  n.line(n.cyan('  └────────────────────────────────────────────────────────┘'));
  n.line();
  n.line('  A database has to answer an awkward question: if the power dies');
  n.line('  mid-write, what happens to the data?');
  n.line();
  n.line('  The answer nearly all of them use is a ' + n.bold('write-ahead log') + ' — before');
  n.line('  changing anything in memory, first append a description of the');
  n.line('  change to a file on disk. Crash, and the file is still there.');
  n.line();
  n.line(`  ${n.dim('Six short lessons. You control the pace; we stop after each one.')}`);
  n.line(`  ${n.dim('Writes really do land in')} data/*.wal.log ${n.dim('— open them as you go.')}`);
  n.line();
}

type Choice = 'next' | 'replay' | 'quit';

async function pause(rl: readline.Interface, index: number): Promise<Choice> {
  const done = index + 1;
  const next = lessons[index + 1];

  n.line(n.dim('  ────────────────────────────────────────────────────────'));
  n.line(`  ${n.bold(`${done} of ${lessons.length}`)} done.` + (next ? `  Up next: ${n.cyan(next.title)}` : ''));

  if (!interactive) {
    n.line(n.dim('  (not a terminal — playing straight through)'));
    n.line();
    return 'next';
  }

  const answer = (
    await rl.question(
      `  ${n.green('[enter]')} continue   ${n.yellow('[r]')} replay this lesson   ${n.red('[q]')} quit  `,
    )
  )
    .trim()
    .toLowerCase();

  n.line();
  if (answer === 'q' || answer === 'quit') return 'quit';
  if (answer === 'r' || answer === 'replay') return 'replay';
  return 'next';
}

async function finale(rl: readline.Interface): Promise<boolean> {
  n.line(n.dim('  ────────────────────────────────────────────────────────'));
  n.line();
  n.line(`  ${n.bold('That is all six.')} You now know what a write-ahead log is for,`);
  n.line('  what an LSN is, why replay is safe to repeat, and why the log is');
  n.line('  written ahead of the change it describes.');
  n.line();
  n.line('  The sandbox is where it sticks. Try this in it:');
  n.line(n.dim('    SET user:1 alice  →  CRASH  →  GET user:1  →  RECOVER  →  GET user:1'));
  n.line();

  if (!interactive) {
    n.line(`  ${n.dim('Run it with:')} ${n.cyan('npm run repl')}`);
    n.line();
    return false;
  }

  const answer = (await rl.question(`  Open the sandbox now? ${n.dim('[Y/n]')}  `)).trim().toLowerCase();
  if (answer === 'n' || answer === 'no') {
    n.line();
    n.line(`  ${n.dim('Any time:')} ${n.cyan('npm run repl')}`);
    n.line();
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const fast = wantsFast(process.argv.slice(2));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => rl.close());

  welcome();

  if (interactive) {
    await rl.question(`  ${n.green('[enter]')} to begin  `);
  }

  let index = 0;
  let finished = false;

  while (index < lessons.length) {
    const lesson = lessons[index];
    if (!lesson) break;

    await runOne(lesson, fast);

    if (index === lessons.length - 1) {
      finished = true;
      break;
    }

    const choice = await pause(rl, index);
    if (choice === 'quit') {
      n.line(`  Stopped after lesson ${lesson.id}. Pick up where you left off with `
        + n.cyan(`npm run lesson ${lesson.id + 1}`));
      n.line();
      break;
    }
    if (choice === 'next') index += 1;
    // 'replay' leaves the index alone and runs the same lesson again.
  }

  const wantsRepl = finished ? await finale(rl) : false;
  rl.close();

  // The REPL builds its own readline interface, so ours must be gone first.
  if (wantsRepl) await startRepl();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
