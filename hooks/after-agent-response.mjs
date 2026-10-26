#!/usr/bin/env node
import { runRecordingHook } from '../lib/recording-hook.mjs';
import { noteAnswer } from '../lib/turn-record.mjs';

runRecordingHook((sessionId, turnId, input) => noteAnswer(sessionId, turnId, input.text));
