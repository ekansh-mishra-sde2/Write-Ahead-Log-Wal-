/**
 * The one place in this project that controls time.
 *
 * Everything that "takes a while" -- the fake disk write in wal.ts, the pauses
 * between narration steps -- goes through `sleep()` here. That means a single
 * flag (`--fast`) can strip every delay out of the whole program, which is what
 * makes the lessons pipeable and quick to re-run once you've seen them.
 */

let fast = false;

/** Turn all artificial delays off. Set from `--fast` or WAL_FAST=1. */
export function setFast(value: boolean): void {
  fast = value;
}

export function isFast(): boolean {
  return fast;
}

/** Pause for `ms`, unless fast mode is on -- then return immediately. */
export function sleep(ms: number): Promise<void> {
  if (fast || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
