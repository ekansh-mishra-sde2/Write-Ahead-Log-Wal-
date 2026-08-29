import fs from 'node:fs';
import path from 'node:path';

/**
 * A dumb wrapper over a text file. No cleverness on purpose.
 *
 * Note that every call here is *synchronous* fs. Real database engines care
 * enormously about async I/O, batching and fsync, but none of that teaches you
 * what a WAL is -- it just adds machinery between you and the idea. So the file
 * access is boring and blocking, and the only thing that "takes time" in this
 * project is the deliberate fake delay in wal.ts.
 */
export class LogFile {
  constructor(private readonly file: string) {}

  /** The real path on your machine. Go on, open it in an editor. */
  path(): string {
    return this.file;
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  /** Append one line. This is the ONLY way bytes get into the log. */
  appendLine(text: string): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, text + '\n', 'utf8');
  }

  /** Read every non-empty line. A missing file is simply an empty log. */
  readAllLines(): string[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /** Delete the log entirely. Not a WAL operation -- just a reset button. */
  reset(): void {
    if (fs.existsSync(this.file)) fs.rmSync(this.file);
  }
}

/** The default log every lesson and the REPL use. */
export function defaultLogFile(): LogFile {
  return new LogFile(path.join(process.cwd(), 'data', 'wal.log'));
}
