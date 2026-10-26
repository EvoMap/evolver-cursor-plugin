#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { cursorModelRunner } from '../lib/cursor-agent.mjs';
import { DISTILL_TIMEOUT_MS, distillLeftovers } from '../lib/distiller.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { recordReuseLocally } from '../lib/local-ledger.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { dropStaleCandidates } from '../lib/session-distill.mjs';
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
const housekeeping = [await ranCleanly(() => pruneOldSessions()), await ranCleanly(() => dropStaleCandidates())];
// Installing Evolver can take minutes, so it runs beside report delivery and distillation rather than before them.
const jobs = await Promise.all([
  tasks.has(ENGINE_TASK) && ranCleanly(() => setUpEngine(engineRuntime())),
  tasks.has(DRAIN_TASK) && ranCleanly(() => drainOutbox({ proxyFetch: createProxyClient(), recordLocally: recordReuseLocally })),
  tasks.has(DISTILL_TASK) && ranCleanly(() => distillLeftovers({
    proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
    runModel: cursorModelRunner(),
  })),
].filter(Boolean));
process.exit([...housekeeping, ...jobs].every(Boolean) ? 0 : 1);
