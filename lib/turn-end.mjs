import { appliedVerdictOf } from './applied.mjs';
import { takeUnreported } from './injected-assets.mjs';
import { queueReports } from './report-queue.mjs';
import { rememberForRetention } from './retention-pending.mjs';
import { immediateReportOf, reportedReuseOf } from './reuse.mjs';
import { candidateOf, rememberCandidate, skipReason } from './session-distill.mjs';
import { closeOpenTurn, settleTurn } from './session-state.mjs';
import { takeTurnRecord } from './turn-record.mjs';
import { outcomeOfReason } from './turn-outcomes.mjs';

const EMPTY_RECORD = { checks: [], commands: [], paths: [], edits: [], answer: '' };

function reportsOf(assets, { sessionId, turn, reasonKind, record }) {
  return assets.map((asset) => immediateReportOf({
    asset,
    sessionId,
    turn: turn ?? asset.turn,
    reasonKind,
    checks: record.checks,
    applied: appliedVerdictOf({ strategyText: asset.strategyText, ...record }).verdict,
  }));
}

export function abortedReports(assets) {
  return assets.map((asset) => ({
    report: reportsOf([asset], { sessionId: asset.sessionId, reasonKind: 'aborted', record: EMPTY_RECORD })[0],
    sessionId: asset.sessionId,
  }));
}

function rememberTurnCandidate({ sessionId, session, reasonKind, record, reusedAsset, model, ownerPid }) {
  if (skipReason(reasonKind, record, { reusedAsset })) return;
  rememberCandidate(sessionId, candidateOf({ prompt: session.prompt, record, model, turn: session.turn, pid: ownerPid() }));
}

/**
 * Every injected strategy is reported when its turn ends, with the turn's own evidence; the turn itself becomes
 * the session's distillation candidate when it finished verified without reusing one. Returns the reuses the
 * next prompt may label, and whether anything was queued. `ownerPid` is only asked when a candidate is written.
 */
function closeTurn({ sessionId, session, reasonKind, model, projectDir, ownerPid }) {
  const record = takeTurnRecord(sessionId, session.turnId);
  if (!outcomeOfReason(reasonKind)) return { reuses: [], queued: false };
  const reports = reportsOf(takeUnreported(sessionId, session.turn), { sessionId, turn: session.turn, reasonKind, record });
  const reuses = reports.map(reportedReuseOf);
  queueReports(reports.map((report) => ({ report, sessionId })));
  rememberForRetention({ sessionId, projectDir, reuses, editedBefore: record.editedBefore });
  const reusedAsset = reuses.some((reuse) => reuse.applied === 'used');
  rememberTurnCandidate({ sessionId, session, reasonKind, record, reusedAsset, model, ownerPid });
  return { reuses, queued: reports.length > 0 };
}

/**
 * Closes the session's open turn (`turnId`, or any when omitted) as `reasonKind`, reports it, and settles it with
 * its reuses. Returns them, and whether anything was queued; null when no such turn was open.
 */
export function endOpenTurn({ sessionId, turnId, reasonKind, model = null, projectDir, ownerPid = () => null }) {
  const session = closeOpenTurn(sessionId, turnId);
  if (!session) return null;
  const ended = closeTurn({ sessionId, session, reasonKind, model, projectDir, ownerPid });
  settleTurn(sessionId, session.turnId, ended.reuses);
  return ended;
}
