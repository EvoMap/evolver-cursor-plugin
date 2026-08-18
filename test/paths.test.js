'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../hooks/_paths');

const ORIGINAL_GIT = process.env.EVOLVER_GIT_BINARY;

beforeEach(() => {
  paths._resetGitBinaryCache();
});

afterEach(() => {
  if (ORIGINAL_GIT === undefined) {
    delete process.env.EVOLVER_GIT_BINARY;
  } else {
    process.env.EVOLVER_GIT_BINARY = ORIGINAL_GIT;
  }
  paths._resetGitBinaryCache();
});

test('isGitWorkspace is filesystem-only: empty dir is not a repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-nongit-'));
  assert.equal(paths.isGitWorkspace(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isGitWorkspace treats a .git directory as a repo without spawning git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-gitdir-'));
  fs.mkdirSync(path.join(dir, '.git'));
  process.env.EVOLVER_GIT_BINARY = '';
  paths._resetGitBinaryCache();
  assert.equal(paths.isGitWorkspace(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitUsability: repo without a usable git binary is not usable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-nousable-'));
  fs.mkdirSync(path.join(dir, '.git'));
  process.env.EVOLVER_GIT_BINARY = '';
  paths._resetGitBinaryCache();
  const u = paths.gitUsability(dir);
  assert.equal(u.hasRepo, true);
  assert.equal(u.gitBinary, null);
  assert.equal(u.usable, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGit refuses git init even when a binary is available', () => {
  delete process.env.EVOLVER_GIT_BINARY;
  paths._resetGitBinaryCache();
  const r = paths.runGit(['init', '/tmp/evolver-should-not-init']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /never run git init/);
});

test('runGit refuses the Cursor installer argv (flags then init)', () => {
  delete process.env.EVOLVER_GIT_BINARY;
  paths._resetGitBinaryCache();
  const r = paths.runGit([
    '-c',
    'credential.interactive=false',
    '-c',
    'core.fsmonitor=false',
    'init',
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /never run git init/);
});

test('runGit refuses clone', () => {
  const r = paths.runGit(['clone', 'https://example.invalid/repo.git']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /never run git clone/);
});

test('empty EVOLVER_GIT_BINARY makes git unavailable without spawning', () => {
  process.env.EVOLVER_GIT_BINARY = '';
  paths._resetGitBinaryCache();
  assert.equal(paths.resolveGitBinary(), null);
  const r = paths.runGit(['rev-parse', '--is-inside-work-tree']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not available/);
});

test('runGit rev-parse works in this repo when git is available', () => {
  delete process.env.EVOLVER_GIT_BINARY;
  paths._resetGitBinaryCache();
  const bin = paths.resolveGitBinary();
  assert.ok(bin);
  const r = paths.runGit(['rev-parse', '--is-inside-work-tree'], __dirname);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'true');
});
