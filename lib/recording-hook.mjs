import { generationIdOf, runHook, sessionIdOf } from './hook-io.mjs';
import { recordingTurnOf } from './session-state.mjs';

/** Runs `note(sessionId, turnId, input)` for a hook of the session's open turn; one of a closed or older turn records nothing. */
export function runRecordingHook(note) {
  runHook((input) => {
    const sessionId = sessionIdOf(input);
    const turnId = sessionId ? recordingTurnOf(sessionId, generationIdOf(input)) : undefined;
    if (turnId !== undefined) note(sessionId, turnId, input);
    return {};
  });
}
