#!/usr/bin/env node
import { projectDirOf } from '../lib/project-dir.mjs';
import { runRecordingHook } from '../lib/recording-hook.mjs';
import { noteFileBeforeEdit } from '../lib/turn-record.mjs';

runRecordingHook((sessionId, turnId, input) => noteFileBeforeEdit(sessionId, turnId, projectDirOf(input), input));
