#!/usr/bin/env node
import { runRecordingHook } from '../lib/recording-hook.mjs';
import { noteFileEdit } from '../lib/turn-record.mjs';

runRecordingHook(noteFileEdit);
