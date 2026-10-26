import path from 'node:path';

import { contentHashOf } from './retention-pending.mjs';
import { appendStateLine, hashedName, removeState, statePath, takeStateLines } from './state-file.mjs';
import { isVerificationCommand, shellCheckFailed } from './verification.mjs';

export const SHELL_TOOL = 'Shell';
const DELETE_TOOL = 'Delete';
export const EDIT_TOOLS = new Set(['Write', DELETE_TOOL]);

const CHECK_COMMAND_MAX_CHARS = 200;
const PATH_KEYS = ['path', 'file_path'];
const NOT_RUN_FAILURES = new Set(['permission_denied']);
// What Cursor's Shell tool says for a result that is neither an exit, a timeout nor a refusal, such as a command
// moved to the background before it finished: no verdict yet.
const UNSETTLED_SHELL_ERROR = 'Unknown error';

// One file a turn, so the next prompt never clears notes the previous turn's stop has yet to take.
const recordPath = (sessionId, turnId) => statePath(hashedName('cursor-turn', `${sessionId}\n${turnId ?? ''}`, 'jsonl'));

function freshTurnRecord() {
  return { checks: [], commands: [], paths: [], edits: [], changedLines: 0, editedBefore: new Map(), answer: '' };
}

function editedPathOf(input) {
  return typeof input?.file_path === 'string' && input.file_path ? input.file_path : null;
}

export function noteFileBeforeEdit(sessionId, turnId, projectDir, { tool_name: name, tool_input: input }) {
  const edited = EDIT_TOOLS.has(name) ? editedPathOf(input) : null;
  if (!edited) return;
  const file = path.resolve(projectDir, edited);
  appendStateLine(recordPath(sessionId, turnId), { kind: 'before', path: file, hash: contentHashOf(file) });
}

function parsedOutput(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { output: String(text ?? '') };
  }
}

function checkOf(command, result) {
  if (!isVerificationCommand(command)) return {};
  return { check: { command: command.slice(0, CHECK_COMMAND_MAX_CHARS), failed: shellCheckFailed(result) } };
}

function baseNote(input) {
  return {
    kind: 'tool',
    ...(typeof input?.command === 'string' && { command: input.command }),
    paths: PATH_KEYS.map((key) => input?.[key]).filter((value) => typeof value === 'string'),
  };
}

/**
 * A tool call that ran, as postToolUse hands it over; Shell output is `{"output","exitCode"}` as JSON text. A
 * deleted file is an edit here, since afterFileEdit reports only writes.
 */
export function noteOf({ tool_name: name, tool_input: input, tool_output: output }) {
  const note = baseNote(input);
  if (name === SHELL_TOOL && note.command) return { ...note, ...checkOf(note.command, parsedOutput(output)) };
  if (name === DELETE_TOOL) return { ...note, edited: note.paths };
  return note;
}

function lineCountOf(text) {
  return typeof text === 'string' && text ? text.split('\n').length : 0;
}

/** An applied edit, as afterFileEdit hands it over: the file it changed and how many lines it took out or put in. */
export function editNoteOf({ file_path: file, edits }) {
  const paths = typeof file === 'string' && file ? [file] : [];
  const changedLines = (Array.isArray(edits) ? edits : []).reduce((total, change) => total + lineCountOf(change?.old_string) + lineCountOf(change?.new_string), 0);
  return { kind: 'edit', paths, edited: paths, changedLines };
}

/**
 * A tool call that failed, as postToolUseFailure hands it over: a Shell command that exited non-zero or timed
 * out failed its check; one the person interrupted or that is still running has no verdict, and one that was
 * denied never ran.
 */
export function failureNoteOf({ tool_name: name, tool_input: input, error_message: message, failure_type: type, is_interrupt: interrupted }) {
  if (NOT_RUN_FAILURES.has(type)) return null;
  const note = baseNote(input);
  if (name !== SHELL_TOOL || !note.command || interrupted || message === UNSETTLED_SHELL_ERROR) return note;
  return { ...note, ...checkOf(note.command, { exitCode: 1, output: message }) };
}

export function noteToolResult(sessionId, turnId, toolUse) {
  appendStateLine(recordPath(sessionId, turnId), noteOf(toolUse));
}

export function noteToolFailure(sessionId, turnId, toolUse) {
  const note = failureNoteOf(toolUse);
  if (note) appendStateLine(recordPath(sessionId, turnId), note);
}

export function noteFileEdit(sessionId, turnId, edit) {
  appendStateLine(recordPath(sessionId, turnId), editNoteOf(edit));
}

export function noteAnswer(sessionId, turnId, text) {
  if (typeof text === 'string' && text.trim()) appendStateLine(recordPath(sessionId, turnId), { kind: 'answer', text: text.trim() });
}

function addNote(record, note) {
  if (note.kind === 'before') {
    if (!record.editedBefore.has(note.path)) record.editedBefore.set(note.path, note.hash);
    return;
  }
  if (note.kind === 'answer') {
    record.answer = note.text;
    return;
  }
  if (typeof note.command === 'string') record.commands.push(note.command);
  if (note.check) record.checks.push(note.check);
  record.paths.push(...(note.paths ?? []));
  record.edits.push(...(note.edited ?? []));
  record.changedLines += note.changedLines ?? 0;
}

export function turnRecordOf(notes) {
  const record = freshTurnRecord();
  for (const note of notes) addNote(record, note);
  return record;
}

/** What the turn did, as its tool and response hooks noted it; the notes leave the disk once taken. */
export function takeTurnRecord(sessionId, turnId) {
  const { lines, commit } = takeStateLines(recordPath(sessionId, turnId));
  commit();
  return turnRecordOf(lines);
}

export function forgetTurnRecord(sessionId, turnId) {
  removeState(recordPath(sessionId, turnId));
}
