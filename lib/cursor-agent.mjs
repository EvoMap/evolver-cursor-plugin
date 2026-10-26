import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HEADLESS_MARKER } from './hook-io.mjs';

const MODEL_ID = /^[\w.:@/-]+$/;
const UNNAMED_MODELS = new Set(['default', 'auto', 'unknown']);
const ERROR_MAX_CHARS = 300;
const KILL_GRACE_MS = 5_000;
const CLI_NAME = 'cursor-agent';
const SHORT_NAME = 'agent';
// On Windows only an .exe is spawned without a shell; through cmd.exe, which a .cmd shim needs, the prompt
// argument would overrun its 8191-character command line.
const executableName = (name, platform) => (platform === 'win32' ? `${name}.exe` : name);

function pathDirs(env) {
  return String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
}

function realPathOf(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

// `agent` is the name Cursor's installer gives its CLI, but a generic one, so it only counts when it resolves
// into the CLI's own install.
function isCursorAgent(file) {
  return realPathOf(file)?.includes(CLI_NAME) ?? false;
}

/** The Cursor agent CLI to run headless: `cursor-agent`, else an `agent` that is it; null when there is none. */
export function cursorAgentCli({ env = process.env, home = os.homedir(), platform = process.platform, exists = fs.existsSync, isCli = isCursorAgent } = {}) {
  const dirs = [...pathDirs(env), path.join(home, '.local', 'bin')];
  const inDirs = (name) => dirs.map((dir) => path.join(dir, executableName(name, platform)));
  return inDirs(CLI_NAME).find((file) => exists(file)) ?? inDirs(SHORT_NAME).find((file) => exists(file) && isCli(file)) ?? null;
}

/**
 * One answer, not an agent run: print mode in ask mode (read-only, and without --force nothing is applied),
 * an empty workspace so no project rules, hooks or files come along, and the prompt as the argument the docs
 * name. The marker keeps this plugin's own hooks, which the CLI loads too, from recalling or distilling here.
 */
export function cursorAgentArguments(model, workspace, prompt) {
  const named = MODEL_ID.test(model ?? '') && !UNNAMED_MODELS.has(model) ? ['--model', model] : [];
  return ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', workspace, ...named, prompt];
}

function parsedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The answer of one `--output-format json` run, which prints a single `result` object and no token usage. */
export function completionOf({ code, stdout, stderr }) {
  const result = parsedJson(String(stdout ?? '').trim());
  if (code !== 0 || !result || result.is_error || typeof result.result !== 'string') {
    const detail = `${stderr ?? ''}${stdout ?? ''}`.trim().slice(-ERROR_MAX_CHARS) || 'empty output';
    throw new Error(`cursor-agent exited ${code}: ${detail}`);
  }
  return { answer: result.result, usage: null };
}

function runCli(file, args, signal) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, [HEADLESS_MARKER]: '1' };
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: os.homedir(), env });
    let stdout = '';
    let stderr = '';
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' }));
      else resolve({ code, stdout, stderr });
    });
  });
}

/**
 * `runModel(model, prompt, signal)` over the headless Cursor agent CLI, in a scratch workspace that is removed
 * afterwards. Rejects with code ENOENT when there is no CLI to run; hooks have no model API of their own.
 */
export function cursorModelRunner({ cli = cursorAgentCli(), run = runCli } = {}) {
  return async (model, prompt, signal) => {
    if (!cli) throw Object.assign(new Error('no cursor-agent executable on PATH or in ~/.local/bin'), { code: 'ENOENT' });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-distill-'));
    try {
      return completionOf(await run(cli, cursorAgentArguments(model, workspace, prompt), signal));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  };
}
