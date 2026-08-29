import { runOne, wantsFast } from './lesson-runner.js';
import { findLesson, lessons } from './lessons/index.js';
import * as n from './narrate.js';

/**
 * Run lessons individually, by number.
 *
 *   npm run lesson 4              one lesson, at reading speed
 *   npm run lessons               every lesson, back to back, no pauses
 *   npm run lesson 4 -- --fast    no delays (also: WAL_FAST=1)
 *
 * For the guided, one-at-a-time walkthrough, use `npm start` instead.
 */

function usage(): void {
  n.line();
  n.line(n.bold('  Write-Ahead Log, by example'));
  n.line();
  n.line(`  ${n.cyan('npm start')}              the guided walkthrough — start here`);
  n.line('  npm run lesson <n>     jump straight to one lesson');
  n.line('  npm run lessons        run all of them back to back');
  n.line('  npm run repl           the free-play sandbox');
  n.line(n.dim('  add -- --fast to skip the pauses'));
  n.line();
  for (const lesson of lessons) {
    n.line(`  ${n.cyan(String(lesson.id))}  ${n.bold(lesson.title)}`);
    n.line(`     ${n.dim(lesson.summary)}`);
  }
  n.line();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fast = wantsFast(args);
  const target = args.filter((a) => !a.startsWith('-'))[0];

  if (!target) {
    usage();
    return;
  }

  const selected =
    target === 'all' ? lessons : [findLesson(Number(target))].filter((l) => l !== undefined);

  if (selected.length === 0) {
    n.line(n.red(`  No lesson "${target}". Lessons are 1–${lessons.length}, or "all".`));
    process.exitCode = 1;
    return;
  }

  for (const lesson of selected) {
    await runOne(lesson, fast);
  }

  if (selected.length > 1) {
    n.line(
      n.bold(`  That is all ${lessons.length}. Now go break it yourself:  `) + n.cyan('npm run repl'),
    );
    n.line();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
