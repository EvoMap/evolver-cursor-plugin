import { detectSignals } from './signals.mjs';

const VERIFICATION_COMMANDS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|type-check|check)\b/,
  /\bnode\s+--test\b/,
  /\b(?:jest|vitest|mocha|pytest|rspec|phpunit|tsc|eslint|ruff|mypy)\b/,
  /\bgo\s+(?:test|build|vet)\b/,
  /\bcargo\s+(?:test|build|check|clippy)\b/,
  /\bdotnet\s+(?:test|build)\b/,
  /\b(?:mvn|gradle|gradlew)\b/,
  /\bmake\b/,
];

const FAILURE_SIGNALS = new Set(['test_failure', 'log_error']);

// Summaries of a passing run still name failures by count ("0 failed",
// "failures: 0"); only those counts are dropped, so "1 failed, 0 errors"
// still reads as a failure.
const ZERO_COUNT = /\b0\s+(?:failed|failures?|errors?)\b|\b(?:failed|failures?|errors?)\s*[:=]\s*0\b/gi;

export function isVerificationCommand(command) {
  return typeof command === 'string' && VERIFICATION_COMMANDS.some((pattern) => pattern.test(command));
}

export function verificationFailed(output) {
  const evidence = String(output ?? '').replace(ZERO_COUNT, '');
  return detectSignals(evidence).some((signal) => FAILURE_SIGNALS.has(signal));
}

// Cursor hands the Shell tool's exit code to postToolUse; a non-zero one decides, like dsh's isError. A zero
// one does not clear the run, since a failing suite piped through `tail` still exits zero.
export function shellCheckFailed({ exitCode, output }) {
  return (Number.isInteger(exitCode) && exitCode !== 0) || verificationFailed(output);
}
