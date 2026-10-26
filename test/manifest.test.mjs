import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

// Cursor 3.27.6 rejects a whole hooks file that names one event outside this list.
const CURSOR_HOOK_EVENTS = new Set([
  'beforeShellExecution', 'beforeMCPExecution', 'afterShellExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit',
  'beforeTabFileRead', 'afterTabFileEdit', 'stop', 'beforeSubmitPrompt', 'afterAgentResponse', 'afterAgentThought', 'sessionStart',
  'sessionEnd', 'preCompact', 'subagentStart', 'subagentStop', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'workspaceOpen',
]);

test('every manifest carries the same minor-bumped version', () => {
  const plugin = readJson('.cursor-plugin/plugin.json');
  const market = readJson('.cursor-plugin/marketplace.json');
  assert.equal(plugin.version, '2.2.0');
  assert.equal(market.metadata.version, '2.2.0');
  assert.equal(market.plugins[0].version, '2.2.0');
  assert.equal(readJson('package.json').version, '2.2.0');
  assert.equal(market.plugins[0].source, '.');
});

test('the plugin ships hooks and commands only: no MCP server, skill, rule or tool reaches the model', () => {
  const plugin = readJson('.cursor-plugin/plugin.json');
  assert.deepEqual(Object.keys(plugin).filter((key) => ['skills', 'rules', 'agents', 'mcpServers', 'variables'].includes(key)), []);
  for (const path of ['mcp.json', 'skills', 'rules', 'agents']) assert.equal(existsSync(new URL(path, root)), false, path);
});

test('hooks.json is version 1, names only events Cursor knows, and every hook script exists', () => {
  const { version, hooks } = readJson('hooks/hooks.json');
  assert.equal(version, 1);
  for (const [event, scripts] of Object.entries(hooks)) {
    assert.ok(CURSOR_HOOK_EVENTS.has(event), event);
    for (const { command, timeout } of scripts) {
      const script = /\$\{CURSOR_PLUGIN_ROOT\}\/(hooks\/[\w-]+\.mjs)/.exec(command)[1];
      assert.ok(existsSync(new URL(script, root)), script);
      assert.ok(timeout > 0);
    }
  }
  assert.ok(hooks.beforeSubmitPrompt[0].timeout >= 600, 'a plugin command may run the CLI for ten minutes');
});
