import { LogFile } from '../storage.js';
import path from 'node:path';

/** Every lesson looks like this. */
export interface Lesson {
  id: number;
  title: string;
  summary: string;
  run(): Promise<void>;
}

/**
 * Each lesson gets its own clean log file so you can run them in any order,
 * or the same one five times, without state leaking between them.
 */
export function freshLog(lessonId: number): LogFile {
  const file = new LogFile(path.join(process.cwd(), 'data', `lesson-${lessonId}.wal.log`));
  file.reset();
  return file;
}
