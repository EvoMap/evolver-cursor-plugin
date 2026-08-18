// SPDX-License-Identifier: MIT
// Copyright (c) 2026 EvoMap
//
// Shared path / workspace helpers for the Evolver Cursor plugin hooks.
// Pure Node.js built-ins, no external dependencies. Every exported helper is
// defensive: it must never throw, because the hooks that call it are expected
// to emit valid JSON and exit 0 even under failure conditions.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Pattern an external tool relies on for the workspace identifier: a lowercase
// hex string of at least 32 characters. Keep this in sync with the contract.
const WORKSPACE_ID_PATTERN = /^[a-f0-9]{32,}$/i;

const GIT_PROBE_TIMEOUT_MS = 2000;
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

// Cached result of git-binary resolution. `undefined` = not yet probed;
// `null` = git must not be spawned (missing, or macOS Xcode stub);
// string = argv0 to pass to spawnSync.
let resolvedGitBinary = undefined;

const DARWIN_GIT_FALLBACKS = ['/opt/homebrew/bin/git', '/usr/local/bin/git'];
const FORBIDDEN_GIT_SUBCOMMANDS = new Set(['init', 'clone', 'daemon']);
// Global git options that consume the following argv entry. Needed so
// `git -c credential.interactive=false init` is still recognized as `init`
// (Cursor's plugin installer uses this shape).
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '-o',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);

function gitSubcommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') {
      continue;
    }
    if (arg === '--') {
      const next = args[i + 1];
      return typeof next === 'string' ? next : '';
    }
    if (GIT_OPTIONS_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    return arg;
  }
  return '';
}

/**
 * Return true when `candidate` is a string pointing at an existing regular file.
 */
function looksLikeFile(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  try {
    return fs.statSync(candidate).isFile();
  } catch (_err) {
    return false;
  }
}

/**
 * Return true when `candidate` is a string pointing at an existing directory.
 * Any stat failure is swallowed and treated as "not a directory".
 */
function looksLikeDir(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  try {
    return fs.statSync(candidate).isDirectory();
  } catch (_err) {
    return false;
  }
}

/**
 * Reset the cached git-binary probe. Exported for tests only.
 */
function _resetGitBinaryCache() {
  resolvedGitBinary = undefined;
}

/**
 * Look up `cmd` on PATH without executing it. Returns an absolute path or null.
 */
function lookUpOnPath(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) {
    return null;
  }
  const pathVar = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts =
    process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathVar.split(sep)) {
    if (!dir) {
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (looksLikeFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * True when macOS has no developer directory configured, so `/usr/bin/git` is
 * the Xcode stub that prints "No developer tools were found" and pops the
 * install dialog. `xcode-select -p` reports this without triggering the GUI.
 */
function darwinDeveloperDirMissing() {
  if (process.platform !== 'darwin') {
    return false;
  }
  try {
    const result = spawnSync('xcode-select', ['-p'], {
      shell: false,
      timeout: GIT_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status !== 0;
  } catch (_err) {
    return true;
  }
}

/**
 * Resolve a git binary that is safe to spawn. Never returns `/usr/bin/git`
 * when that path is the Xcode CLT stub — spawning it is what produces the
 * Cursor "Error loading plugin" / `git init` + xcode-select failure.
 *
 * Override: set `EVOLVER_GIT_BINARY` to an absolute path, or to empty to
 * force "git unavailable".
 *
 * @returns {string|null}
 */
function resolveGitBinary() {
  if (resolvedGitBinary !== undefined) {
    return resolvedGitBinary;
  }

  if (Object.prototype.hasOwnProperty.call(process.env, 'EVOLVER_GIT_BINARY')) {
    const override = process.env.EVOLVER_GIT_BINARY;
    resolvedGitBinary =
      typeof override === 'string' && override.length > 0 ? override : null;
    return resolvedGitBinary;
  }

  const pathGit = lookUpOnPath('git');

  if (darwinDeveloperDirMissing()) {
    if (pathGit && pathGit !== '/usr/bin/git') {
      resolvedGitBinary = pathGit;
      return resolvedGitBinary;
    }
    for (const candidate of DARWIN_GIT_FALLBACKS) {
      if (looksLikeFile(candidate)) {
        resolvedGitBinary = candidate;
        return resolvedGitBinary;
      }
    }
    resolvedGitBinary = null;
    return null;
  }

  resolvedGitBinary = pathGit || 'git';
  return resolvedGitBinary;
}

/**
 * Spawn git with non-interactive env. Never runs `init` / `clone`.
 * Returns { status, stdout, stderr }. status is 1 on any failure, including
 * "git is not available".
 */
function runGit(args, cwd, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!Array.isArray(args) || args.length === 0) {
    return { status: 1, stdout: '', stderr: 'git: missing arguments' };
  }
  const sub = gitSubcommand(args);
  if (FORBIDDEN_GIT_SUBCOMMANDS.has(sub)) {
    return {
      status: 1,
      stdout: '',
      stderr: `evolver hooks never run git ${sub}`,
    };
  }

  const bin = resolveGitBinary();
  if (!bin) {
    return { status: 1, stdout: '', stderr: 'git is not available' };
  }

  try {
    const result = spawnSync(bin, args, {
      cwd: looksLikeDir(cwd) ? cwd : undefined,
      shell: false,
      timeout: typeof opts.timeout === 'number' ? opts.timeout : GIT_TIMEOUT_MS,
      maxBuffer:
        typeof opts.maxBuffer === 'number' ? opts.maxBuffer : GIT_MAX_BUFFER,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
      }),
    });
    return {
      status: typeof result.status === 'number' ? result.status : 1,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (_err) {
    return { status: 1, stdout: '', stderr: '' };
  }
}

/**
 * Diagnose git usability for a directory without spawning the Xcode stub.
 */
function gitUsability(dir) {
  const repoRoot = findRepoRoot(dir);
  const binary = resolveGitBinary();
  return {
    hasRepo: repoRoot !== null,
    gitBinary: binary,
    usable: repoRoot !== null && binary !== null,
  };
}

/**
 * Resolve the directory of the user's current project.
 *
 * Preference order:
 *   1. CURSOR_PROJECT_DIR  (if it names an existing directory)
 *   2. CLAUDE_PROJECT_DIR  (if it names an existing directory)
 *   3. the process working directory
 */
function resolveProjectDir() {
  const fromCursor = process.env.CURSOR_PROJECT_DIR;
  if (looksLikeDir(fromCursor)) {
    return fromCursor;
  }
  const fromClaude = process.env.CLAUDE_PROJECT_DIR;
  if (looksLikeDir(fromClaude)) {
    return fromClaude;
  }
  return process.cwd();
}

/**
 * Determine whether `dir` lives inside a git working tree.
 *
 * Uses a filesystem walk for `.git` (directory or worktree file) so we never
 * spawn git — on macOS without Xcode CLT, spawning `/usr/bin/git` pops the
 * developer-tools dialog and can surface as Cursor's "Error loading plugin".
 */
function isGitWorkspace(dir) {
  return findRepoRoot(dir) !== null;
}

/**
 * Return the path to the evolution memory graph (a JSONL file).
 *
 * Resolution order:
 *   1. MEMORY_GRAPH_PATH override, if set.
 *   2. `<projectDir>/memory/evolution/memory_graph.jsonl` — but only if it
 *      already EXISTS (an evolver-managed project owns this file). We never
 *      create a project-local graph in an arbitrary folder, so plain projects
 *      fall through to the user-level path.
 *   3. The user-level `~/.evolver/memory/evolution/memory_graph.jsonl`, whose
 *      parent directory is best-effort created.
 */
function findMemoryGraph(projectDir) {
  const override = process.env.MEMORY_GRAPH_PATH;
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  if (looksLikeDir(projectDir)) {
    const projectPath = path.join(
      projectDir,
      'memory',
      'evolution',
      'memory_graph.jsonl'
    );
    try {
      if (fs.statSync(projectPath).isFile()) {
        return projectPath;
      }
    } catch (_err) {
      // Not present — fall through to the user-level default.
    }
  }
  const defaultPath = path.join(
    os.homedir(),
    '.evolver',
    'memory',
    'evolution',
    'memory_graph.jsonl'
  );
  try {
    fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
  } catch (_err) {
    // Best effort only; callers tolerate a missing directory.
  }
  return defaultPath;
}

/**
 * Walk upward from `start` looking for the directory that directly contains a
 * `.git` entry (either a directory for normal repos or a file for worktrees /
 * submodules). Returns the repo root, or null if none is found.
 */
function findRepoRoot(start) {
  let current = path.resolve(start);
  // Guard against pathological loops on weird filesystems.
  let guard = 0;
  while (guard < 256) {
    guard += 1;
    try {
      if (fs.existsSync(path.join(current, '.git'))) {
        return current;
      }
    } catch (_err) {
      // Ignore and keep climbing.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break; // reached filesystem root
    }
    current = parent;
  }
  return null;
}

/**
 * Read the workspace-id file at `idFile`, applying symlink / regular-file
 * guards. Returns the validated id string, or null if the file is missing,
 * a symlink, not a regular file, or malformed.
 *
 * `dotEvolverDir` is the `.evolver` directory; if it is itself a symlink we
 * refuse to trust anything beneath it.
 */
function readWorkspaceIdFile(dotEvolverDir, idFile) {
  // Refuse to follow a symlinked `.evolver` directory.
  let dirStat;
  try {
    dirStat = fs.lstatSync(dotEvolverDir);
  } catch (_err) {
    return { ok: false, missing: true };
  }
  if (dirStat.isSymbolicLink()) {
    return { ok: false, missing: false };
  }

  let fileStat;
  try {
    fileStat = fs.lstatSync(idFile);
  } catch (_err) {
    // ENOENT (or similar) => treat as missing so the caller may create it.
    return { ok: false, missing: true };
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    return { ok: false, missing: false };
  }

  let raw;
  try {
    raw = fs.readFileSync(idFile, 'utf8');
  } catch (_err) {
    return { ok: false, missing: false };
  }
  const value = raw.trim();
  if (WORKSPACE_ID_PATTERN.test(value)) {
    return { ok: true, id: value };
  }
  return { ok: false, missing: false };
}

/**
 * Compute the workspace root used to anchor the workspace-id file.
 *   - OPENCLAW_WORKSPACE wins if set.
 *   - Otherwise find the git repo root above `projectDir`; if that root has a
 *     `workspace/` subdirectory use it, else the root itself.
 *   - If no repo root exists, fall back to `projectDir`.
 */
function computeWorkspaceRoot(projectDir) {
  const explicit = process.env.OPENCLAW_WORKSPACE;
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit;
  }
  const repoRoot = findRepoRoot(projectDir);
  if (!repoRoot) {
    return projectDir;
  }
  const nestedWorkspace = path.join(repoRoot, 'workspace');
  if (looksLikeDir(nestedWorkspace)) {
    return nestedWorkspace;
  }
  return repoRoot;
}

/**
 * Resolve (or lazily create) the forge-resistant workspace identifier.
 *
 * Contract with external tooling — do not change without coordination:
 *   - file path:  <workspaceRoot>/.evolver/workspace-id
 *   - file mode:  0600
 *   - format:     a single 32+ char hex string
 *
 * Returns the id string, or null when it cannot be safely read or created.
 * Never throws.
 */
function resolveWorkspaceId(projectDir) {
  try {
    const fromEnv = process.env.EVOLVER_WORKSPACE_ID;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return String(fromEnv);
    }

    const workspaceRoot = computeWorkspaceRoot(projectDir);
    const dotEvolverDir = path.join(workspaceRoot, '.evolver');
    const idFile = path.join(dotEvolverDir, 'workspace-id');

    // First attempt: read an existing, trusted file.
    const existing = readWorkspaceIdFile(dotEvolverDir, idFile);
    if (existing.ok) {
      return existing.id;
    }
    if (!existing.missing) {
      // A file (or `.evolver`) is present but failed the guards. Never clobber
      // it — surface "unknown" instead.
      return null;
    }

    // File is genuinely missing: create it. Re-check the `.evolver` symlink
    // guard right before writing.
    try {
      const dirStat = fs.lstatSync(dotEvolverDir);
      if (dirStat.isSymbolicLink()) {
        return null;
      }
    } catch (_err) {
      // Does not exist yet — that is fine, mkdir below.
    }

    try {
      fs.mkdirSync(dotEvolverDir, { recursive: true });
    } catch (_err) {
      return null;
    }

    const fresh = crypto.randomBytes(16).toString('hex'); // 32 hex chars
    let fd;
    try {
      // O_EXCL + O_NOFOLLOW: fail rather than follow a symlink or overwrite a
      // racing writer's file.
      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW;
      fd = fs.openSync(idFile, flags, 0o600);
      fs.writeSync(fd, fresh);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        // Someone created it between our check and write — re-read it through
        // the same guards.
        const raced = readWorkspaceIdFile(dotEvolverDir, idFile);
        return raced.ok ? raced.id : null;
      }
      return null;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (_err) {
          // ignore
        }
      }
    }

    // Tighten permissions in case the umask widened them.
    try {
      fs.chmodSync(idFile, 0o600);
    } catch (_err) {
      // best effort
    }
    return fresh;
  } catch (_err) {
    // EACCES / EIO / anything else: degrade to "unknown workspace".
    return null;
  }
}

module.exports = {
  resolveProjectDir,
  isGitWorkspace,
  findRepoRoot,
  findMemoryGraph,
  resolveWorkspaceId,
  resolveGitBinary,
  runGit,
  gitUsability,
  _resetGitBinaryCache,
};
