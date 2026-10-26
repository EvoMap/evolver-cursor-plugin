#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { EVOLVE_COMMAND, typedCommandOf } from '../lib/commands.mjs';
import { feedbackLabelOf } from '../lib/feedback-label.mjs';
import { generationIdOf, runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { injectedIds, rememberInjected } from '../lib/injected-assets.mjs';
import { answerOfCommand } from '../lib/plugin-commands.mjs';
import { hubGene, promptTextOf } from '../lib/prime.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { recordRecall } from '../lib/recall-log.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { correctionReportOf } from '../lib/reuse.mjs';
import { dropCandidate } from '../lib/session-distill.mjs';
import { readSession, settledSession, updateSession } from '../lib/session-state.mjs';
import { endOpenTurn } from '../lib/turn-end.mjs';
import { forgetTurnRecord } from '../lib/turn-record.mjs';

const RECALL_TIMEOUT_MS = 6_000;
const STOP_WAIT_MS = 3_000;

// Cursor fires the next prompt without waiting for the previous turn's stop (a prompt typed mid-turn aborts that
// turn first), so the previous turn gets a moment to close and settle: its reports and candidate land before this
// prompt labels or drops them. One that stays open never had a stop (Cursor itself went down) and is closed as an
// error.
async function closeLeftTurn(sessionId, input) {
  const session = await settledSession(sessionId, STOP_WAIT_MS);
  if (session.closed) return { labelable: session.settling ? [] : session.labelable, queued: false };
  const ended = endOpenTurn({ sessionId, reasonKind: 'error', projectDir: projectDirOf(input) });
  return { labelable: ended?.reuses ?? [], queued: Boolean(ended?.queued) };
}

// The next prompt is the only verdict on a turn available without asking anyone: when it reads as a
// correction, the reuse reports are revised and the turn is no longer worth distilling.
function reportFollowUp(sessionId, labelable, prompt) {
  if (!prompt) return false;
  const label = feedbackLabelOf(prompt);
  if (label === 'correction') dropCandidate(sessionId);
  const reports = labelable.map((reuse) => correctionReportOf(reuse, label)).filter((report) => report !== null);
  queueReports(reports.map((report) => ({ report, sessionId })));
  return reports.length > 0;
}

function openTurn(sessionId, input, prompt, { keepLabelable }) {
  const turnId = generationIdOf(input);
  forgetTurnRecord(sessionId, turnId);
  return updateSession(sessionId, (session) => ({
    ...session, turn: session.turn + 1, turnId, closed: false, settling: false, prompt,
    labelable: keepLabelable ? session.labelable : [], keepsLabelable: keepLabelable,
  }));
}

async function recalledStrategy(sessionId, turn, prompt) {
  const match = await hubGene(createProxyClient({ timeoutMs: RECALL_TIMEOUT_MS }), promptTextOf(prompt), {
    listedIds: injectedIds(sessionId),
    onOutcome: recordRecall,
  });
  const [assetId] = match.ids;
  if (!assetId) return '';
  rememberInjected(sessionId, assetId, { turn, strategyText: match.text, pid: hostProcess()?.pid ?? null });
  return match.text;
}

// A command that fails still answers in the chat: passed on, its prompt would tell the model the hooks are off.
async function commandAnswer(typed, sessionId) {
  try {
    return await answerOfCommand(typed, sessionId);
  } catch (error) {
    return `${typed.name} failed: ${String(error?.message ?? error)}`;
  }
}

// Only the agent chat (editor or CLI) names its composer_mode; an inline edit sends none and drops added context.
function isAgentChat(input) {
  return typeof input.composer_mode === 'string';
}

// `/evolver-evolve` is a request, not a verdict on the previous turn, so that turn's reuses wait for the next prompt.
async function promptTurn(sessionId, input, prompt, typed) {
  const isEvolve = typed?.name === EVOLVE_COMMAND;
  const closed = await closeLeftTurn(sessionId, input);
  const followedUp = !isEvolve && reportFollowUp(sessionId, closed.labelable, prompt);
  if (closed.queued || followedUp) startInBackground([DRAIN_TASK]);
  const { turn } = openTurn(sessionId, input, prompt, { keepLabelable: isEvolve });
  const context = await recalledStrategy(sessionId, turn, prompt);
  return context ? { continue: true, additional_context: context } : {};
}

async function beforeSubmitPrompt(input) {
  const sessionId = sessionIdOf(input);
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!sessionId || !isAgentChat(input)) return {};
  const typed = typedCommandOf(prompt);
  const answer = await commandAnswer(typed, sessionId);
  if (answer !== null) return { continue: false, user_message: answer };
  const generationId = generationIdOf(input);
  if (generationId && generationId === readSession(sessionId).turnId) return {};
  return promptTurn(sessionId, input, prompt, typed);
}

runHook(beforeSubmitPrompt);
