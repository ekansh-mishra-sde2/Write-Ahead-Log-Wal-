/**
 * The shape of everything this project writes to disk.
 *
 * There are exactly two operations and one record type. That is the whole
 * vocabulary of our little database -- deliberately tiny, so the interesting
 * part (when things are written, and in what order) has nowhere to hide.
 */

/** Log Sequence Number: the position of a record in the log. Starts at 1. */
export type Lsn = number;

/** The two mutations our database understands. */
export type Op = 'SET' | 'DEL';

/**
 * One line of data/wal.log. Serialized as JSON, one record per line:
 *
 *   {"lsn":1,"op":"SET","key":"user:1","value":"alice"}
 *   {"lsn":2,"op":"DEL","key":"user:1"}
 *
 * `value` is absent on DEL records -- there is nothing to store.
 */
export interface LogRecord {
  lsn: Lsn;
  op: Op;
  key: string;
  value?: string;
}

/** Render a record the way the narration prints it. */
export function describeRecord(record: LogRecord): string {
  return record.op === 'SET'
    ? `${record.key} = ${record.value}`
    : `${record.key} (deleted)`;
}
