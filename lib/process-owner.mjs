import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import path from 'node:path';

const CURSOR_EXECUTABLE = /cursor/i;
const PS_TIMEOUT_MS = 1_000;

/**
 * Whether the process that wrote a state entry has exited. Signal 0 only probes: ESRCH means no such process;
 * EPERM means it exists under another user. An entry without a pid is never taken for a dead owner's.
 */
export function ownerIsGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

export function processTableOf(psOutput) {
  const table = new Map();
  for (const line of String(psOutput).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] });
  }
  return table;
}

function processTable() {
  try {
    return processTableOf(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: PS_TIMEOUT_MS }));
  } catch {
    return new Map();
  }
}

// Linux's ps names a process by at most 15 characters of its executable (`node` for the CLI), so the full path
// comes from /proc; macOS's ps gives it already.
function executablePathOf(pid, command) {
  if (path.isAbsolute(command)) return command;
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return command;
  }
}

/**
 * The Cursor process this hook runs for. The editor starts hooks from its extension host, sometimes through a
 * shell, and the CLI from its own process, so the nearest ancestor whose executable path names Cursor
 * (`Cursor Helper (Plugin)`, `cursor-agent`) outlives the hook and dies with the window or CLI that runs the
 * session. Null where no process table can be read (Windows).
 */
export function hostProcess(start = process.ppid, table = processTable()) {
  for (let pid = start; pid > 1;) {
    const entry = table.get(pid);
    if (!entry) return null;
    if (CURSOR_EXECUTABLE.test(executablePathOf(pid, entry.command))) return { pid };
    pid = entry.ppid;
  }
  return null;
}
