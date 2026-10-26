#!/usr/bin/env node
import { runRecordingHook } from '../lib/recording-hook.mjs';
import { noteToolResult } from '../lib/turn-record.mjs';

runRecordingHook(noteToolResult);
