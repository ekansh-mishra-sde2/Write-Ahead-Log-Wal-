import { setFast } from './clock.js';
import * as n from './narrate.js';
import type { Lesson } from './lessons/index.js';

/**
 * Shared by both entry points (`npm start` and `npm run lesson`) so the two
 * cannot drift apart in how they treat a lesson.
 */

/** Lesson 6 IS the timing. Running it with --fast would delete the point. */
export const TIMING_CRITICAL = new Set([6]);

export function wantsFast(argv: string[]): boolean {
  return argv.includes('--fast') || process.env['WAL_FAST'] === '1';
}

/** Print a lesson's header and run it, honouring (or overriding) fast mode. */
export async function runOne(lesson: Lesson, fastRequested: boolean): Promise<void> {
  const fast = fastRequested && !TIMING_CRITICAL.has(lesson.id);
  setFast(fast);

  n.header(lesson.id, lesson.title, lesson.summary);
  if (fastRequested && !fast) {
    n.line(n.yellow('  (ignoring --fast: this lesson is about timing, so it runs at full speed)'));
    n.line();
  }

  await lesson.run();
}
