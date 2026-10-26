import { OUTBOX_TTL_MS } from './report-outbox.mjs';
import { referenceReuseSavings } from './savings.mjs';
import { readState, statePath, updateState } from './state-file.mjs';

const ledgerPath = () => statePath('cursor-savings.json');
const NO_SAVINGS = { tokens: 0, turns: 0 };

/** The tokens a turn spent itself, as Cursor's stop counts them: everything but what it read back from the cache. */
export function freshTokensOf({ input_tokens: input, output_tokens: output, cache_write_tokens: cacheWrite }) {
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return input + output + (Number.isFinite(cacheWrite) ? cacheWrite : 0);
}

/**
 * What reusing an injected strategy saved a turn, or null when nothing is counted: a saving is claimed only for a
 * reuse a passing check vouched for, and never above what the turn itself spent, since the estimator prices
 * deriving a whole approach from scratch, which a single answered question never cost.
 */
export function turnSavingOf({ reuses, record, freshTokens }) {
  const lastCheck = record.checks.at(-1);
  if (reuses.length === 0 || !lastCheck || lastCheck.failed || freshTokens === null) return null;
  return Math.min(referenceReuseSavings(record.changedLines), freshTokens);
}

const added = (savings = NO_SAVINGS, tokens) => ({ tokens: savings.tokens + tokens, turns: savings.turns + 1 });

function recentSessions(sessions, now) {
  return Object.fromEntries(Object.entries(sessions ?? {}).filter(([, entry]) => now - Number(entry?.at) <= OUTBOX_TTL_MS));
}

/** Adds a turn's saving to its chat's and to the running total; chats unseen for the outbox TTL are dropped. */
export function recordSaving(sessionId, tokens, now = Date.now()) {
  updateState(ledgerPath(), {}, (ledger) => {
    const sessions = recentSessions(ledger.sessions, now);
    return {
      total: added(ledger.total, tokens),
      sessions: { ...sessions, [sessionId]: { ...added(sessions[sessionId], tokens), at: now } },
    };
  });
}

/** The savings counted for one chat and for all chats so far. */
export function savingsOf(sessionId) {
  const ledger = readState(ledgerPath(), {});
  const { tokens = 0, turns = 0 } = ledger.sessions?.[sessionId] ?? {};
  return { session: { tokens, turns }, total: { ...NO_SAVINGS, ...ledger.total } };
}
