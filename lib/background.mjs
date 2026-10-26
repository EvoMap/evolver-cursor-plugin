import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../scripts/background-worker.mjs', import.meta.url));

export const ENGINE_TASK = 'engine';
export const DRAIN_TASK = 'drain';
export const DISTILL_TASK = 'distill';

// Cursor kills a hook at its timeout and waits for sessionEnd only while a window closes, so slow work
// (installing Evolver, posting reports, distilling) runs in a detached child in a process group of its own.
export function startInBackground(tasks) {
  if (tasks.length === 0) return;
  const child = spawn(process.execPath, [WORKER, ...new Set(tasks)], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() });
  child.unref();
}
