import { lesson as l1 } from './01-the-problem.js';
import { lesson as l2 } from './02-append-only-log.js';
import { lesson as l3 } from './03-lsn-and-records.js';
import { lesson as l4 } from './04-crash-and-replay.js';
import { lesson as l5 } from './05-idempotent-replay.js';
import { lesson as l6 } from './06-write-ahead-ordering.js';
import { lesson as l7 } from './07-checkpoints.js';
import type { Lesson } from './lesson.js';

/** In order. Each one assumes you have seen the one before it. */
export const lessons: Lesson[] = [l1, l2, l3, l4, l5, l6, l7];

export function findLesson(id: number): Lesson | undefined {
  return lessons.find((l) => l.id === id);
}

export type { Lesson };
