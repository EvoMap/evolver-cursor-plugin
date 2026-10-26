#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { forgetSession, takeUnreported } from '../lib/injected-assets.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { closeCandidate } from '../lib/session-distill.mjs';
import { endSession, settledSession } from '../lib/session-state.mjs';
import { abortedReports, endOpenTurn } from '../lib/turn-end.mjs';

const STOP_WAIT_MS = 2_000;

// Cursor waits for sessionEnd only while a window closes, and kills it at its timeout, so it only settles state
// on disk; the closed candidate is distilled by the detached worker it starts, or claimed by the next session
// start if that worker fails. A stop already settling its turn is let finish first, so its candidate is the one
// closed here; a turn still running is cut off by the close and ends aborted.
runHook(async (input) => {
  const sessionId = sessionIdOf(input);
  if (!sessionId) return {};
  const session = await settledSession(sessionId, STOP_WAIT_MS);
  if (!session.closed) endOpenTurn({ sessionId, reasonKind: 'aborted', projectDir: projectDirOf(input) });
  queueReports(abortedReports(takeUnreported(sessionId, Infinity)));
  closeCandidate(sessionId);
  endSession(sessionId);
  forgetSession(sessionId);
  startInBackground([DRAIN_TASK, DISTILL_TASK]);
  return {};
});
