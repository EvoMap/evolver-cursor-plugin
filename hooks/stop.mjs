#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { generationIdOf, runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { freshTokensOf, recordSaving, turnSavingOf } from '../lib/savings-ledger.mjs';
import { modelOf } from '../lib/session-distill.mjs';
import { endOpenTurn } from '../lib/turn-end.mjs';

const REASON_KINDS = { completed: 'completed', aborted: 'aborted', error: 'error' };

runHook((input) => {
  const sessionId = sessionIdOf(input);
  const ended = sessionId && endOpenTurn({
    sessionId,
    turnId: generationIdOf(input),
    reasonKind: REASON_KINDS[input.status] ?? 'error',
    model: modelOf(input),
    projectDir: projectDirOf(input),
    ownerPid: () => hostProcess()?.pid ?? null,
  });
  if (!ended) return {};
  if (ended.queued) startInBackground([DRAIN_TASK]);
  const saving = turnSavingOf({ ...ended, freshTokens: freshTokensOf(input) });
  if (saving !== null) recordSaving(sessionId, saving);
  return {};
});
