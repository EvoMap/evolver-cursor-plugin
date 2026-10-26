import assert from 'node:assert/strict';
import { test } from 'node:test';

import { endSession, readSession, recordingTurnOf, updateSession } from '../lib/session-state.mjs';
import { freshHome } from './helpers/sandbox.mjs';

test('sessionEnd ends only the turn it saw: a turn opened since keeps the session', (t) => {
  t.after(freshHome());
  updateSession('s', (session) => ({ ...session, turn: 2, turnId: 'g2', closed: false }));
  assert.equal(endSession('s', 1), false);
  assert.equal(readSession('s').turnId, 'g2');
  updateSession('s', (session) => ({ ...session, closed: true }));
  assert.equal(endSession('s', 2), true);
  assert.deepEqual({ turn: readSession('s').turn, turnId: readSession('s').turnId }, { turn: 2, turnId: null });
});

test('a hook records into the open turn only with that turn\'s generation', (t) => {
  t.after(freshHome());
  updateSession('s', (session) => ({ ...session, turn: 1, turnId: 'g1', closed: false }));
  assert.equal(recordingTurnOf('s', 'g1'), 'g1');
  assert.equal(recordingTurnOf('s', null), undefined);
  assert.equal(recordingTurnOf('s', 'g0'), undefined);
});
