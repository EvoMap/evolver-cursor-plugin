import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshTokensOf, recordSaving, savingsOf, turnSavingOf } from '../lib/savings-ledger.mjs';
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

test('savings add up per chat and in total; a chat unseen for the outbox TTL leaves its chat entry but not the total', (t) => {
  t.after(freshHome());
  const day = 24 * 60 * 60 * 1000;
  recordSaving('old', 10_000, 0);
  recordSaving('new', 2_000, 9 * day);
  recordSaving('new', 3_000, 9 * day);
  assert.deepEqual(savingsOf('new'), { session: { tokens: 5_000, turns: 2 }, total: { tokens: 15_000, turns: 3 } });
  assert.deepEqual(savingsOf('old').session, { tokens: 0, turns: 0 });
  assert.deepEqual(savingsOf('never'), { session: { tokens: 0, turns: 0 }, total: { tokens: 15_000, turns: 3 } });
});
