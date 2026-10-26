#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { cursorModelRunner } from '../lib/cursor-agent.mjs';
import { DISTILL_TIMEOUT_MS, distillLeftovers } from '../lib/distiller.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { recordReuseLocally } from '../lib/local-ledger.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { pruneOldSessions } from '../lib/session-state.mjs';

async function ranCleanly(work) {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
}

const tasks = new Set(process.argv.slice(2));
const results = [await ranCleanly(() => pruneOldSessions())];
if (tasks.has(ENGINE_TASK)) results.push(await ranCleanly(() => setUpEngine(engineRuntime())));
if (tasks.has(DRAIN_TASK)) {
  results.push(await ranCleanly(() => drainOutbox({ proxyFetch: createProxyClient(), recordLocally: recordReuseLocally })));
}
if (tasks.has(DISTILL_TASK)) {
  results.push(await ranCleanly(() => distillLeftovers({
    proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
    runModel: cursorModelRunner(),
  })));
}
process.exit(results.every(Boolean) ? 0 : 1);
