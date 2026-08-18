'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

test('plugin.json is v2.1.0 with optional Configure variables', () => {
  const manifest = readJson('.cursor-plugin/plugin.json');
  assert.equal(manifest.version, '2.1.0');
  assert.equal(manifest.variables.type, 'object');
  const props = manifest.variables.properties;
  for (const key of [
    'EVOMAP_NODE_ID',
    'EVOMAP_HUB_URL',
    'EVOMAP_PROXY_PORT',
    'EVOLVE_STRATEGY',
  ]) {
    assert.ok(props[key], `missing variable ${key}`);
  }
  assert.ok(
    !manifest.variables.required || manifest.variables.required.length === 0,
    'Configure fields must be optional so a blank Node ID still loads'
  );
});

test('marketplace.json points at the repo root and matches version', () => {
  const market = readJson('.cursor-plugin/marketplace.json');
  assert.equal(market.metadata.version, '2.1.0');
  assert.equal(market.plugins[0].source, '.');
  assert.equal(market.plugins[0].version, '2.1.0');
});

test('mcp.json env placeholders match plugin variables', () => {
  const mcp = readJson('mcp.json');
  const env = mcp.mcpServers['evolver-proxy'].env;
  assert.equal(env.EVOMAP_PROXY_PORT, '${EVOMAP_PROXY_PORT}');
  assert.equal(env.EVOMAP_HUB_URL, '${EVOMAP_HUB_URL}');
  assert.equal(env.EVOMAP_NODE_ID, '${EVOMAP_NODE_ID}');
  assert.equal(env.EVOLVE_STRATEGY, '${EVOLVE_STRATEGY}');
});

test('hooks.json records on both stop and sessionEnd', () => {
  const hooks = readJson('hooks/hooks.json');
  assert.ok(hooks.hooks.stop);
  assert.ok(hooks.hooks.sessionEnd);
});

test('session-start source never tells the agent to run git init', () => {
  const src = read('hooks/session-start.js');
  assert.equal(src.includes('git init'), false);
});

test('hooks do not spawn git by literal argv0', () => {
  const files = [
    'hooks/_paths.js',
    'hooks/session-start.js',
    'hooks/session-end.js',
    'hooks/signal-detect.js',
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.equal(
      /spawnSync\(\s*['"]git['"]/.test(src),
      false,
      `${rel} must not spawnSync('git', ...)`
    );
  }
});

test('session-start on a non-git folder emits the nongit notice, not git init', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-ss-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-ss-state-'));
  const proc = spawn('node', [path.join(ROOT, 'hooks', 'session-start.js')], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      CURSOR_PROJECT_DIR: dir,
      EVOLVER_SESSION_STATE_DIR: state,
      EVOLVER_GIT_BINARY: '',
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  proc.stdout.on('data', (c) => {
    stdout += c.toString('utf8');
  });
  proc.stderr.on('data', () => {});
  proc.stdin.end('{}\n');
  const status = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.match(parsed.additionalContext || '', /not a git repository/);
  assert.equal((parsed.additionalContext || '').includes('git init'), false);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
