#!/usr/bin/env node
import { runRecordingHook } from '../lib/recording-hook.mjs';
import { noteToolFailure } from '../lib/turn-record.mjs';

runRecordingHook(noteToolFailure);
