'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BRIDGE = path.join(__dirname, '..', 'mcp', 'evolver-proxy.mjs');

function startBridge() {
  const proc = spawn('node', [BRIDGE], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  return proc;
}

function rpc(proc, msg, timeoutMs) {
  const limit = timeoutMs || 4000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error(`RPC timeout waiting for id=${msg.id}`));
    }, limit);
    let buf = '';
    function onData(chunk) {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (_err) {
          continue;
        }
        if (parsed && parsed.id === msg.id) {
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          resolve(parsed);
        }
      }
    }
    proc.stdout.on('data', onData);
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

test('MCP bridge ignores unexpanded ${EVOMAP_PROXY_PORT} placeholders', async () => {
  const proc = spawn('node', [BRIDGE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      EVOMAP_PROXY_PORT: '${EVOMAP_PROXY_PORT}',
    }),
  });
  let stderr = '';
  proc.stderr.on('data', (c) => {
    stderr += c.toString('utf8');
  });
  try {
    await rpc(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    assert.match(stderr, /127\.0\.0\.1:19820/);
    assert.equal(stderr.includes('${EVOMAP_PROXY_PORT}'), false);
  } finally {
    proc.kill('SIGTERM');
  }
});

test('MCP bridge lists query search and report_reuse, rejects empty search', async () => {
  const proc = startBridge();
  try {
    await rpc(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    const listed = await rpc(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const tools = listed.result && listed.result.tools;
    assert.ok(Array.isArray(tools));
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('evolver_report_reuse'));
    assert.ok(names.includes('evolver_search_assets'));
    assert.ok(names.includes('evolver_recipe_search'));
    assert.ok(names.includes('evolver_recipe_express'));
    const recipeIdx = names.indexOf('evolver_recipe_search');
    const fallbackIdx = names.indexOf('evolver_search_assets');
    assert.ok(recipeIdx >= 0 && recipeIdx < fallbackIdx);
    const search = tools.find((t) => t.name === 'evolver_search_assets');
    assert.match(search.description, /Fallback/);
    assert.ok(search.inputSchema.properties.query);
    assert.ok(
      !search.inputSchema.required ||
        !search.inputSchema.required.includes('signals')
    );
    const empty = await rpc(proc, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'evolver_search_assets', arguments: {} },
    });
    assert.equal(empty.result.isError, true);
    assert.match(empty.result.content[0].text, /query/);
    const missingRecipe = await rpc(proc, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'evolver_recipe_express', arguments: {} },
    });
    assert.equal(missingRecipe.result.isError, true);
    assert.match(missingRecipe.result.content[0].text, /recipeId/);
  } finally {
    proc.kill('SIGTERM');
  }
});
