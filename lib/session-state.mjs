import fs from 'node:fs';
import path from 'node:path';

import { STATE_TTL_MS } from './report-outbox.mjs';
import { hashedName, readState, stateDir, statePath, updateState } from './state-file.mjs';

const SESSION_FILE = /^cursor-(?:session|turn|injected)-[0-9a-f]{16}\.jsonl?$/;

const sessionPath = (sessionId) => statePath(hashedName('cursor-session', sessionId));

const EMPTY_SESSION = { turn: 0, turnId: null, closed: true, settling: false, prompt: '', labelable: [], keepsLabelable: false };
const SETTLE_POLL_MS = 50;

export function readSession(sessionId) {
  return { ...EMPTY_SESSION, ...readState(sessionPath(sessionId), {}) };
}

// A turn is open from its prompt until its stop; Cursor names it by generation_id, which a payload may lack.
function isOpenTurn(session, turnId) {
  return !session.closed && (!turnId || !session.turnId || turnId === session.turnId);
}

/**
 * The open turn a tool or response hook of `turnId` belongs to, or undefined when it should record nothing. Unlike
 * closing, recording needs the exact generation: a late hook of an earlier turn must not land in the current one.
 */
export function recordingTurnOf(sessionId, turnId) {
  const session = readSession(sessionId);
  return !session.closed && (turnId ?? null) === session.turnId ? session.turnId : undefined;
}

export function updateSession(sessionId, change) {
  return updateState(sessionPath(sessionId), {}, (state) => change({ ...EMPTY_SESSION, ...state }));
}

/**
 * Marks the session's open turn closed and settling, and returns it as it was, or null when `turnId` is not open
 * (any turn when omitted). Closed, it records nothing more; settling, the next prompt waits for its reports and
 * candidate before it reads the reuses to label or drops the candidate.
 */
export function closeOpenTurn(sessionId, turnId) {
  let opened = null;
  updateSession(sessionId, (session) => {
    if (!isOpenTurn(session, turnId)) return undefined;
    opened = session;
    return { ...session, closed: true, settling: true };
  });
  return opened;
}

/**
 * Ends the settling of `turnId` with the reuses its follow-up may label; a turn that reused nothing and keeps the
 * earlier ones (a command turn) leaves them. A session that moved on is left alone.
 */
export function settleTurn(sessionId, turnId, reuses) {
  updateSession(sessionId, (session) => {
    if (!session.settling || session.turnId !== turnId) return undefined;
    const labelable = reuses.length === 0 && session.keepsLabelable ? session.labelable : reuses;
    return { ...session, settling: false, labelable };
  });
}

/** Waits up to `timeoutMs` for the session's turn to be closed and settled; resolves the session as it then is. */
export async function settledSession(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let session = readSession(sessionId);
  while ((!session.closed || session.settling) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    session = readSession(sessionId);
  }
  return session;
}

/**
 * Forgets what the ended session's turns left, but keeps its turn counter: a chat reopened after
 * sessionEnd keeps its conversation_id, and a repeated `cursor:<session>:<turn>` would be taken by the Hub as a duplicate report.
 * The file is pruned with the other session files once it is older than the state TTL. Only the turn the caller saw
 * end is ended: a prompt that opened another turn meanwhile keeps the session, and false is returned.
 */
export function endSession(sessionId, endedTurn) {
  let ended = false;
  updateSession(sessionId, (session) => {
    if (!session.closed || session.turn !== endedTurn) return undefined;
    ended = true;
    return { ...EMPTY_SESSION, turn: session.turn };
  });
  return ended;
}

export function pruneOldSessions(now = Date.now()) {
  let names = [];
  try {
    names = fs.readdirSync(stateDir());
  } catch {
    return;
  }
  for (const name of names.filter((candidate) => SESSION_FILE.test(candidate))) {
    const file = path.join(stateDir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs > STATE_TTL_MS) fs.rmSync(file, { force: true });
    } catch {
    }
  }
}
