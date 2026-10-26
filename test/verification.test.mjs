import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shellCheckFailed, verificationFailed } from '../lib/verification.mjs';

test('a summary that counts real failures beside zero errors still fails', () => {
  assert.equal(verificationFailed('1 failed, 0 errors'), true);
  assert.equal(verificationFailed('tests 3 | failed: 2 | errors: 0'), true);
});

test('a passing summary that counts zero failures passes', () => {
  for (const text of ['ℹ tests 78\nℹ pass 78\nℹ fail 0', 'Tests: 0 failed, 12 passed', 'failures: 0\nerrors: 0', '✔ Validation passed']) {
    assert.equal(verificationFailed(text), false, text);
  }
});

test('a non-zero exit code decides; a zero one still reads the output, since a piped failing suite exits zero', () => {
  assert.equal(shellCheckFailed({ exitCode: 1, output: 'all good' }), true);
  assert.equal(shellCheckFailed({ exitCode: 0, output: 'ℹ pass 3\nℹ fail 0' }), false);
  assert.equal(shellCheckFailed({ exitCode: 0, output: '✖ evicts the oldest\nAssertionError [ERR_ASSERTION]: Expected values to be strictly equal:' }), true);
  assert.equal(shellCheckFailed({ output: 'not ok 1 - adds\n# fail 1\nAssertionError: expected 2' }), true);
});
