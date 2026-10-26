import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editNoteOf, failureNoteOf, noteOf, turnRecordOf } from '../lib/turn-record.mjs';

const shell = (command, output, exitCode = 0) => noteOf({ tool_name: 'Shell', tool_input: { command, cwd: '/p' }, tool_output: JSON.stringify({ output, exitCode }) });

test('a turn record keeps commands, checks with their verdict, touched paths, applied edits and the answer', () => {
  const record = turnRecordOf([
    { kind: 'before', path: '/p/src/lru.js', hash: 'absent' },
    shell('ls src', 'lru.js'),
    shell('npm test', 'AssertionError: expected 1 to equal 2', 1),
    noteOf({ tool_name: 'Read', tool_input: { file_path: '/p/src/old.js' }, tool_output: '{}' }),
    noteOf({ tool_name: 'Write', tool_input: { file_path: '/p/src/lru.js', content: 'whole file' }, tool_output: '{"success":true}' }),
    editNoteOf({ file_path: '/p/src/lru.js', edits: [{ old_string: 'a', new_string: 'export const cache = new Map();' }, { old_string: 'b', new_string: '' }] }),
    shell('npm test', 'ℹ pass 3\nℹ fail 0'),
    { kind: 'answer', text: 'first' },
    { kind: 'answer', text: 'Done.' },
    { kind: 'before', path: '/p/src/lru.js', hash: 'later' },
  ]);
  assert.deepEqual(record.commands, ['ls src', 'npm test', 'npm test']);
  assert.deepEqual(record.checks, [{ command: 'npm test', failed: true }, { command: 'npm test', failed: false }]);
  assert.deepEqual(record.edits, ['export const cache = new Map();'], 'only what the edit wrote in, not the whole file');
  assert.deepEqual(record.paths, ['/p/src/old.js', '/p/src/lru.js', '/p/src/lru.js']);
  assert.deepEqual([...record.editedBefore], [['/p/src/lru.js', 'absent']]);
  assert.equal(record.answer, 'Done.');
});

test('a failed Shell call fails its check unless the person interrupted it, and a denied one never ran', () => {
  const failure = (fields) => failureNoteOf({ tool_name: 'Shell', tool_input: { command: 'npm test' }, error_message: 'Command failed with exit code 1', failure_type: 'error', ...fields });
  assert.deepEqual(failure({}).check, { command: 'npm test', failed: true });
  assert.deepEqual(failure({ failure_type: 'timeout' }).check, { command: 'npm test', failed: true });
  assert.equal(failure({ is_interrupt: true }).check, undefined);
  assert.equal(failure({ is_interrupt: true }).command, 'npm test');
  assert.equal(failure({ failure_type: 'permission_denied' }), null);
});

test('Shell output that is not JSON is read as plain output', () => {
  const [check] = turnRecordOf([noteOf({ tool_name: 'Shell', tool_input: { command: 'npm test' }, tool_output: 'Tests: 1 failed, 0 errors' })]).checks;
  assert.deepEqual(check, { command: 'npm test', failed: true });
});
