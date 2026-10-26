import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshTokensOf, recordReuseTurn, savingsOf, turnSavingOf } from '../lib/savings-ledger.mjs';
import { referenceReuseSavings } from '../lib/savings.mjs';
import { freshHome } from './helpers/sandbox.mjs';

const passed = { checks: [{ command: 'npm test', failed: false }], changedLines: 10 };

test("a turn's fresh tokens are what Cursor's stop counts, without the cache reads", () => {
  assert.equal(freshTokensOf({ input_tokens: 30_000, output_tokens: 2_000, cache_read_tokens: 50_000, cache_write_tokens: 1_000 }), 33_000);
  assert.equal(freshTokensOf({ input_tokens: 30_000, output_tokens: 2_000 }), 32_000);
  assert.equal(freshTokensOf({ status: 'completed' }), null);
});

test('a saving needs a reuse, a passing last check and known tokens, and never exceeds what the turn spent', () => {
  const reuses = [{ assetId: 'a' }];
  assert.equal(turnSavingOf({ reuses, record: passed, freshTokens: 1_000_000 }), referenceReuseSavings(10));
  assert.equal(turnSavingOf({ reuses, record: passed, freshTokens: 5_000 }), 5_000);
  assert.equal(turnSavingOf({ reuses: [], record: passed, freshTokens: 5_000 }), null);
  assert.equal(turnSavingOf({ reuses, record: { checks: [{ command: 'npm test', failed: true }], changedLines: 0 }, freshTokens: 5_000 }), null);
  assert.equal(turnSavingOf({ reuses, record: { checks: [], changedLines: 0 }, freshTokens: 5_000 }), null);
  assert.equal(turnSavingOf({ reuses, record: passed, freshTokens: null }), null);
});

const PASSED = { command: 'npm test', failed: false };
const reusedTurn = (turn, saving, lastCheck = PASSED) => ({ turn, reused: [{ assetId: `sha256:${turn}`, title: `Strategy ${turn}` }], lastCheck, saving });

test('savings add up per chat and in total; a chat unseen for the state TTL leaves its chat entry but not the total', (t) => {
  t.after(freshHome());
  const day = 24 * 60 * 60 * 1000;
  recordReuseTurn('old', reusedTurn(1, 10_000), 0);
  recordReuseTurn('new', reusedTurn(1, 2_000), 4 * day);
  recordReuseTurn('new', reusedTurn(2, 3_000), 4 * day);
  const { session, total, reuses } = savingsOf('new');
  assert.deepEqual({ session, total }, { session: { tokens: 5_000, turns: 2 }, total: { tokens: 15_000, turns: 3 } });
  assert.deepEqual(reuses.map((reuse) => reuse.turn), [1, 2]);
  assert.deepEqual(savingsOf('old').session, { tokens: 0, turns: 0 });
  assert.deepEqual(savingsOf('never'), { session: { tokens: 0, turns: 0 }, reuses: [], total: { tokens: 15_000, turns: 3 } });
});

test('every reuse is listed with its asset and last check, a turn that saved nothing included; only the latest twenty are kept', (t) => {
  t.after(freshHome());
  recordReuseTurn('s', reusedTurn(1, null, { command: 'npm test', failed: true }));
  recordReuseTurn('s', reusedTurn(2, null, null));
  recordReuseTurn('s', { turn: 3, reused: [], lastCheck: PASSED, saving: 99 });
  const { session, reuses } = savingsOf('s');
  assert.deepEqual(session, { tokens: 0, turns: 0 }, 'a turn without a saving adds no saved turn');
  assert.deepEqual(reuses, [
    { turn: 1, assetId: 'sha256:1', title: 'Strategy 1', check: 'failed', saved: null },
    { turn: 2, assetId: 'sha256:2', title: 'Strategy 2', check: 'none', saved: null },
  ]);
  for (let turn = 4; turn < 30; turn += 1) recordReuseTurn('s', reusedTurn(turn, 1));
  assert.equal(savingsOf('s').reuses.length, 20);
  assert.equal(savingsOf('s').reuses[0].turn, 10);
});
