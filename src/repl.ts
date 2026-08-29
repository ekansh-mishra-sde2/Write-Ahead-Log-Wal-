import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setFast } from './clock.js';
import { Database } from './database.js';
import * as n from './narrate.js';
import { defaultLogFile } from './storage.js';

/**
 * A sandbox. No lesson plan, no narration script — just you, a key-value store,
 * and a crash button.
 *
 * The one structural thing worth noticing: every command is awaited before the
 * next prompt is drawn. That keeps the spinner and the prompt off each other's
 * line, and it means CRASH really does land in a quiet moment rather than
 * racing an in-flight write.
 */

const HELP = `
  ${n.bold('Commands')}

    ${n.cyan('SET')} <key> <value>   write a value (logs first, then applies)
    ${n.cyan('GET')} <key>           read a value from memory
    ${n.cyan('DEL')} <key>           delete a key (this is a log record too)

    ${n.cyan('LIST')}                show disk and memory side by side
    ${n.cyan('LOG')}                 dump the raw log file

    ${n.red('CRASH')}               wipe memory, leave the log alone
    ${n.green('RECOVER')}             rebuild memory by replaying the log
    ${n.yellow('RESET')}               delete the log and start over

    ${n.cyan('HELP')}                this
    ${n.cyan('EXIT')}                leave (the log stays on disk)

  ${n.dim('Try: SET user:1 alice → CRASH → GET user:1 → RECOVER → GET user:1')}
`;

export async function startRepl(): Promise<void> {
  setFast(process.argv.includes('--fast') || process.env['WAL_FAST'] === '1');

  const file = defaultLogFile();
  const db = new Database(file, { onStep: n.walNarrator() });

  n.line();
  n.line(n.bold('  Write-Ahead Log sandbox'));
  n.line(n.dim(`  log file: ${file.path().replace(process.cwd() + '/', '')}`));

  const existing = db.logRecords();
  if (existing.length > 0) {
    n.line();
    n.line(
      `  ${n.yellow('Found an existing log')} with ${existing.length} record(s) from a previous run.`,
    );
    n.line(
      n.dim('  Memory starts empty, exactly as it would after a real restart. Type RECOVER.'),
    );
  }
  n.line(n.dim('  HELP for commands.'));
  n.line();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: n.cyan('wal> '),
  });

  // When input is a pipe rather than a keyboard, stdin can hit end-of-file
  // while we are still awaiting a command. Readline closes itself at that
  // point, so we must not try to draw another prompt afterwards.
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => rl.close());

  const commands = async (input: string): Promise<boolean> => {
    const [rawCommand, key, ...rest] = input.trim().split(/\s+/);
    const command = (rawCommand ?? '').toUpperCase();
    const value = rest.join(' ');

    switch (command) {
      case '':
        break;

      case 'SET':
        if (!key || value === '') {
          n.line(n.red('  usage: SET <key> <value>'));
          break;
        }
        await db.set(key, value);
        break;

      case 'DEL':
        if (!key) {
          n.line(n.red('  usage: DEL <key>'));
          break;
        }
        await db.del(key);
        break;

      case 'GET': {
        if (!key) {
          n.line(n.red('  usage: GET <key>'));
          break;
        }
        const found = db.get(key);
        n.line(
          found === undefined
            ? `  ${n.dim('(nil)')} — not in memory`
            : `  ${n.magenta('[MEM]')} ${key} = ${n.bold(found)}`,
        );
        break;
      }

      case 'LIST':
        n.showState(db.logRecords(), db.entries());
        break;

      case 'LOG': {
        const lines = file.readAllLines();
        n.line();
        if (lines.length === 0) {
          n.line(n.dim('    (the log is empty)'));
        } else {
          for (const raw of lines) n.line(n.dim('    ') + raw);
        }
        n.line();
        n.fileHint(file.path());
        break;
      }

      case 'CRASH':
        db.crash();
        n.crashBanner('memtable wiped, process "restarted"');
        break;

      case 'RECOVER':
        await db.recover();
        break;

      case 'RESET':
        file.reset();
        db.crash();
        n.line(n.yellow('  log deleted, memory cleared — restart the REPL to reset LSNs'));
        break;

      case 'HELP':
        n.line(HELP);
        break;

      case 'EXIT':
      case 'QUIT':
        return false;

      default:
        n.line(n.red(`  unknown command: ${command}`) + n.dim('  (HELP for the list)'));
    }

    return true;
  };

  rl.prompt();

  // Readline's async iterator is what makes this correct: it applies
  // backpressure to stdin while we are awaiting a command, so commands run
  // strictly one at a time and the spinner never shares a line with the
  // prompt. (An 'line' event handler does NOT do this -- buffered input fires
  // every listener immediately, and a piped script would run every command at
  // once.)
  for await (const input of rl) {
    let keepGoing = true;
    try {
      keepGoing = await commands(input);
    } catch (error) {
      console.error(error);
    }
    if (!keepGoing) break;
    if (!closed) rl.prompt();
  }

  if (!closed) rl.close();

  n.line();
  n.line(n.dim(`  the log is still there: ${file.path().replace(process.cwd() + '/', '')}`));
  n.line(n.dim('  restart with npm run repl and type RECOVER to bring it back.'));
  n.line();
}

// Only auto-start when this file is the program being run. When `npm start`
// imports it to hand you the sandbox at the end of the walkthrough, it calls
// startRepl() itself -- after closing its own readline interface.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  startRepl().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
