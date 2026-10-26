import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { completionOf, cursorAgentArguments, cursorAgentCli, cursorModelRunner } from '../lib/cursor-agent.mjs';

test('the CLI is cursor-agent on PATH or in ~/.local/bin, else an agent that resolves into the CLI install', () => {
  const env = { PATH: ['/usr/bin', '/opt/bin'].join(':') };
  const present = (...files) => (file) => files.includes(file);
  assert.equal(cursorAgentCli({ env, home: '/h', exists: present('/opt/bin/cursor-agent', '/h/.local/bin/cursor-agent') }), '/opt/bin/cursor-agent');
  assert.equal(cursorAgentCli({ env, home: '/h', exists: present('/h/.local/bin/cursor-agent') }), join('/h', '.local', 'bin', 'cursor-agent'));
  assert.equal(cursorAgentCli({ env, home: '/h', exists: present('/usr/bin/agent'), isCli: () => true }), '/usr/bin/agent');
  assert.equal(cursorAgentCli({ env, home: '/h', exists: present('/usr/bin/agent'), isCli: () => false }), null, 'some other agent');
  assert.equal(cursorAgentCli({ env, home: '/h', platform: 'win32', exists: present('/opt/bin/cursor-agent.cmd') }), null, 'a shim needs cmd.exe');
  assert.equal(cursorAgentCli({ env, home: '/h', platform: 'win32', exists: present('/opt/bin/cursor-agent.exe') }), '/opt/bin/cursor-agent.exe');
});

test('the run is one read-only answer in a scratch workspace, on the session model when Cursor named one', () => {
  assert.deepEqual(cursorAgentArguments('gpt-5', '/tmp/w', 'P'), ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', '/tmp/w', '--model', 'gpt-5', 'P']);
  assert.deepEqual(cursorAgentArguments('default', '/tmp/w', 'P').includes('--model'), false);
  assert.deepEqual(cursorAgentArguments('a b; rm', '/tmp/w', 'P').includes('--model'), false);
});

test('the answer is the result of the JSON object; a failed run throws with its stderr', () => {
  assert.deepEqual(completionOf({ code: 0, stdout: '{"type":"result","is_error":false,"result":"{}"}' }), { answer: '{}', usage: null });
  assert.throws(() => completionOf({ code: 1, stdout: '', stderr: 'Authentication required' }), /cursor-agent exited 1: Authentication required/);
  assert.throws(() => completionOf({ code: 0, stdout: '{"type":"result","is_error":true,"result":"x"}' }), /cursor-agent exited 0/);
});

test('no CLI rejects with ENOENT, which a distillation reads as no model', async () => {
  await assert.rejects(cursorModelRunner({ cli: null })('m', 'p'), { code: 'ENOENT' });
});
