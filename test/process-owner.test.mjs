import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hostProcess, ownerIsGone, processTableOf } from '../lib/process-owner.mjs';
import { deadPid } from './helpers/sandbox.mjs';

const TABLE = processTableOf([
  '  1     0 /sbin/launchd',
  ' 500     1 /Applications/Cursor.app/Contents/MacOS/Cursor',
  ' 600   500 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)',
  ' 700   600 /bin/zsh',
  ' 800   700 /opt/homebrew/bin/node',
  ' 900     1 /Users/me/.local/share/cursor-agent/versions/2026.10.20/node',
  ' 910   900 /bin/bash',
].join('\n'));

test('the owner is the nearest Cursor ancestor, past the shell the extension host runs the hook in', () => {
  assert.deepEqual(hostProcess(700, TABLE), { pid: 600 });
  assert.deepEqual(hostProcess(600, TABLE), { pid: 600 }, 'a hook the extension host starts without a shell');
  assert.deepEqual(hostProcess(910, TABLE), { pid: 900 }, 'a hook the CLI starts');
});

test('without a Cursor ancestor there is no owner, and no owner is never gone', () => {
  assert.equal(hostProcess(1, TABLE), null);
  assert.equal(hostProcess(999, TABLE), null);
  assert.equal(ownerIsGone(null), false);
  assert.equal(ownerIsGone(process.pid), false);
  assert.equal(ownerIsGone(deadPid()), true);
});
