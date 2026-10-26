#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GENE = { title: 'Retry uploads', summary: 'Retry a flaky upload with backoff.', strategy: '1. Measure. 2. Back off.', signals: ['retry'] };

const args = process.argv.slice(2);
appendFileSync(join(homedir(), 'fake-cursor-agent.log'), `${JSON.stringify({ args, headless: process.env.EVOLVER_HEADLESS ?? null })}\n`);
if (process.env.FAKE_AGENT_FAIL) {
  process.stderr.write('Authentication required. Run `agent login`.\n');
  process.exit(1);
}
const answer = process.env.FAKE_AGENT_ANSWER ?? JSON.stringify(GENE);
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 9, result: answer, session_id: 'chat-x' })}\n`);
