import { isFast, sleep } from './clock.js';
import type { Step } from './database.js';
import { describeRecord, type LogRecord } from './types.js';

/**
 * Everything cosmetic lives here, and nothing else does.
 *
 * No dependencies -- the colours are raw ANSI escape codes, the spinner is a
 * setInterval over ten braille characters, and the boxes are string padding.
 * You could delete this file and the database would still work; you just
 * wouldn't be able to see it think.
 */

const isTty = process.stdout.isTTY === true;
const useColor = isTty && !process.env['NO_COLOR'];

const paint =
  (code: string) =>
  (text: string): string =>
    useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const blue = paint('34');
export const magenta = paint('35');
export const cyan = paint('36');

export { sleep } from './clock.js';

/** How long we pause between narration steps so you can actually read them. */
export const BEAT_MS = 700;

/** A readable pause between lesson steps. */
export function beat(ms = BEAT_MS): Promise<void> {
  return sleep(ms);
}

export function line(text = ''): void {
  console.log(text);
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  done(message: string): void;
}

/**
 * Show `label` with an animating spinner until `.done(msg)` is called.
 *
 * When output is piped or fast mode is on there is nothing to animate, so we
 * print the label and the result on one line and move on. That keeps piped
 * output free of escape codes and half-drawn frames.
 */
export function spinner(label: string): Spinner {
  if (!isTty || isFast()) {
    process.stdout.write(label);
    return {
      done(message: string) {
        process.stdout.write(` ${message}\n`);
      },
    };
  }

  let frame = 0;
  process.stdout.write(`${label} ${FRAMES[0]}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    process.stdout.write(`\r\x1b[2K${label} ${dim(FRAMES[frame] ?? '')}`);
  }, 80);

  return {
    done(message: string) {
      clearInterval(timer);
      process.stdout.write(`\r\x1b[2K${label} ${message}\n`);
    },
  };
}

// ---------------------------------------------------------------------------
// Lesson furniture
// ---------------------------------------------------------------------------

export function header(id: number, title: string, summary: string): void {
  const label = `Lesson ${id}: ${title}`;
  line();
  line(cyan('═'.repeat(Math.max(label.length + 4, 60))));
  line(cyan('  ') + bold(label));
  line(cyan('═'.repeat(Math.max(label.length + 4, 60))));
  line(dim('  ' + summary));
  line();
}

let stepCounter = 0;

export function resetSteps(): void {
  stepCounter = 0;
}

export function step(text: string): void {
  stepCounter += 1;
  line(`${blue(`Step ${stepCounter}`)}  ${text}`);
}

export function note(text: string): void {
  line(dim(`        ${text}`));
}

export function crashBanner(detail = 'in-memory state is gone'): void {
  line();
  line(red(bold('  \u{1F4A5} CRASH')) + dim(`  — ${detail}`));
  line(dim('     (the log file on disk is untouched -- a crash cannot un-write bytes)'));
  line();
}

export function takeaway(lines: string[]): void {
  line();
  line(yellow(bold('  What you just learned')));
  for (const item of lines) line(yellow('    • ') + item);
  line();
}

export function fileHint(path: string): void {
  line(dim(`        → open it yourself:  cat ${relative(path)}`));
}

function relative(absolute: string): string {
  const cwd = process.cwd() + '/';
  return absolute.startsWith(cwd) ? absolute.slice(cwd.length) : absolute;
}

// ---------------------------------------------------------------------------
// Side-by-side DISK / MEMORY panels
// ---------------------------------------------------------------------------

export interface Panel {
  title: string;
  lines: string[];
}

const MIN_PANEL_WIDTH = 26;

function boxTop(title: string, width: number): string {
  const label = `─ ${title} `;
  return '┌' + label + '─'.repeat(Math.max(0, width + 2 - label.length)) + '┐';
}

function boxBottom(width: number): string {
  return '└' + '─'.repeat(width + 2) + '┘';
}

/** Render two boxes next to each other. Content must be plain (uncoloured). */
export function panels(left: Panel, right: Panel): void {
  const width = (panel: Panel) =>
    Math.max(MIN_PANEL_WIDTH, panel.title.length + 2, ...panel.lines.map((l) => l.length));

  const lw = width(left);
  const rw = width(right);
  const rows = Math.max(left.lines.length, right.lines.length);

  // A box that ran out of content still gets its walls -- otherwise the shorter
  // of the two panels appears to fall apart halfway down.
  const cell = (text: string | undefined, w: number) =>
    dim('│ ') + (text ?? '').padEnd(w) + dim(' │');

  line('  ' + dim(boxTop(left.title, lw)) + '  ' + dim(boxTop(right.title, rw)));
  for (let i = 0; i < rows; i++) {
    line('  ' + cell(left.lines[i], lw) + '  ' + cell(right.lines[i], rw));
  }
  line('  ' + dim(boxBottom(lw)) + '  ' + dim(boxBottom(rw)));
  line();
}

/** The durable side, as the log file actually reads. */
export function diskPanel(records: LogRecord[]): Panel {
  return {
    title: 'DISK (durable)',
    lines: records.length
      ? records.map(
          (r) =>
            `lsn ${String(r.lsn).padStart(2)}  ${r.op}  ${r.op === 'SET' ? `${r.key} = ${r.value}` : r.key}`,
        )
      : ['(log is empty)'],
  };
}

/** The volatile side: whatever is in RAM right now. */
export function memoryPanel(entries: Array<[string, string]>, title = 'MEMORY (volatile)'): Panel {
  return {
    title,
    lines: entries.length ? entries.map(([k, v]) => `${k} = ${v}`) : ['(empty)'],
  };
}

export function showState(records: LogRecord[], entries: Array<[string, string]>): void {
  panels(diskPanel(records), memoryPanel(entries));
}

// ---------------------------------------------------------------------------
// The Database -> console adapter
// ---------------------------------------------------------------------------

/**
 * Turns Database `Step` events into the [WAL] / [MEM] lines you see scroll by.
 * Shared by the lessons and the REPL so they narrate identically.
 */
export function walNarrator(indent = '  '): (step: Step) => Promise<void> {
  let active: Spinner | null = null;

  return async (event: Step): Promise<void> => {
    switch (event.kind) {
      case 'wal-begin':
        active = spinner(`${indent}${cyan('[WAL]')} writing to disk`);
        break;

      case 'wal-done':
        active?.done(green(`✔ LSN=${event.record.lsn} appended`) + dim(`  ${JSON.stringify(event.record)}`));
        active = null;
        break;

      case 'mem-applied':
        line(`${indent}${magenta('[MEM]')} ${describeRecord(event.record)}`);
        break;

      case 'replay-begin':
        line(`${indent}${cyan('[WAL]')} replaying log — ${event.total} record(s)`);
        break;

      case 'replay-record':
        line(`${indent}${dim('  →')} lsn ${event.record.lsn}  ${describeRecord(event.record)}`);
        await sleep(180);
        break;

      case 'replay-done':
        line(`${indent}${green(`✔ ${event.count} record(s) replayed`)}`);
        break;
    }
  };
}
