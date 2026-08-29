# Write-Ahead Logging, by example

**Learn how a write-ahead log works by running one — then crashing it.**

Seven guided lessons and an interactive sandbox, in plain TypeScript with zero
runtime dependencies.

---

A database has to answer an awkward question: if the power dies mid-write, what
happens to the data? The answer almost all of them use is a **write-ahead log**
— before changing anything in memory, first append a description of the change
to a file on disk. If the process dies, the file is still there, and the state
can be rebuilt by replaying it.

That is the whole idea. This repo exists to make it concrete: there is no real
database here, just small, readable code that mimics database and WAL
operations, writing log files under `data/` that you can open in your editor
while they run.

## Get started

```bash
npm install
npm start
```

`npm start` is the guided walkthrough. It runs the lessons one at a time and
stops between each, so you set the pace — continue, replay the one you just
watched, or quit. At the end it drops you into the sandbox.

Nothing to compile — [tsx](https://tsx.is) runs the TypeScript directly.
Requires Node 20+.

## What you'll learn

| # | Lesson | The point |
|---|--------|-----------|
| 1 | The problem | Data that only exists in RAM is data you will eventually lose |
| 2 | The append-only log | Records are appended, never edited. The log is history, not state |
| 3 | LSNs and the record format | Why every line carries a sequence number |
| 4 | Crash and replay | Lesson 1's disaster, survived |
| 5 | Replay is idempotent | Why it is safe to crash *during* recovery and just start over |
| 6 | Why "write-ahead" | Swap two lines, crash mid-write, watch a confirmed order vanish |
| 7 | Checkpoints | The log can't grow forever — snapshot the state and truncate what it covers |

## All the commands

```bash
npm start                     the guided walkthrough — start here
npm run repl                  jump straight to the sandbox
npm run lesson 4              jump straight to one lesson
npm run lessons               all six back to back, no pauses
npm run lessons -- --fast     skip the narration pauses
npm run typecheck             tsc --noEmit
```

Lessons 6 and 7 ignore `--fast` — their timing *is* the demonstration.

## The sandbox

```
$ npm run repl

wal> SET user:1 alice
  [WAL] writing to disk ⠹ ✔ LSN=1 appended  {"lsn":1,"op":"SET","key":"user:1","value":"alice"}
  [MEM] user:1 = alice

wal> CRASH

  💥 CRASH  — memtable wiped, process "restarted"
     (the log file on disk is untouched -- a crash cannot un-write bytes)

wal> GET user:1
  (nil) — not in memory

wal> RECOVER
  [WAL] replaying log — 1 record(s)
    → lsn 1  user:1 = alice
  ✔ 1 record(s) replayed
```

| Command | |
|---|---|
| `SET <key> <value>` | write a value (logs first, then applies) |
| `GET <key>` | read from memory |
| `DEL <key>` | delete a key — this is a log record too |
| `LIST` | show disk and memory side by side |
| `LOG` | dump the raw log file |
| `CRASH` | wipe memory, leave the log alone |
| `RECOVER` | rebuild memory by replaying the log |
| `RESET` | delete the log and start over |

Quit the process entirely and run `npm run repl` again — it finds the log from
last time. Durability lives in the file, not the process.

## The log file

Everything is written as one JSON record per line. The sandbox uses
`data/wal.log`; each lesson gets its own `data/lesson-<n>.wal.log` (and lesson 7
a `data/lesson-7.snapshot.json`) so they stay independent. Open them whenever you like — they are meant to be read.

```json
{"lsn":1,"op":"SET","key":"user:1","value":"alice"}
{"lsn":2,"op":"SET","key":"user:2","value":"bob"}
{"lsn":3,"op":"SET","key":"user:1","value":"alice.cooper"}
{"lsn":4,"op":"DEL","key":"user:2"}
```

Four lines, and note what they are *not*: line 1 was never edited when `user:1`
changed at line 3, and line 2 was never removed when `user:2` was deleted at
line 4. The log only grows. Current state is what you get by replaying it top
to bottom.

## The code

```
src/
  types.ts         the record format — four fields, and that is the whole vocabulary
  storage.ts       a dumb wrapper over a text file
  clock.ts         the only place time lives: sleep / fast mode
  wal.ts           the log: append() and readAll(). No update. No delete.
  memtable.ts      the volatile side — the part a crash destroys
  database.ts      ← the whole idea lives here, in mutate(), and it is four lines
  narrate.ts       colours, spinner, boxes. Delete it and the database still works
  start.ts         the guided walkthrough
  repl.ts          the sandbox
  run-lesson.ts    run lessons by number
  lesson-runner.ts shared by both entry points
  lessons/         one file per lesson
```

Start with [`src/database.ts`](src/database.ts). Everything else is scaffolding
built to make the ordering inside `mutate()` visible:

```ts
// STEP 1 -- durable first.
const record = await this.wal.append(op, key, value);

// STEP 2 -- volatile second. If we die between these two lines, the record
// is already safely on disk and recovery will pick it up.
this.mem.apply(record);
```

## What this deliberately leaves out

Kept out to hold the idea in one piece: transactions and commit records,
segment rotation, group commit, CRC checksums and torn-write detection, and
real `fsync`. The 40ms "disk write" in
[`src/wal.ts`](src/wal.ts) is a `setTimeout` modelling the *cost* of durability
— a real WAL would call `fsync()` and wait for the drive to confirm.

## License

MIT
