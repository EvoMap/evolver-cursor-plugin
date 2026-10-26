export const HEADLESS_MARKER = 'EVOLVER_HEADLESS';

function parsedInput(raw) {
  try {
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : {};
  } catch {
    return {};
  }
}

export function sessionIdOf(input) {
  const id = input?.conversation_id || input?.session_id;
  return typeof id === 'string' && id ? id : null;
}

export function generationIdOf(input) {
  return typeof input?.generation_id === 'string' && input.generation_id ? input.generation_id : null;
}

/** Whether this hook runs inside the headless distillation, which loads this plugin too. */
export function isHeadlessRun(env = process.env) {
  return env[HEADLESS_MARKER] === '1';
}

// Cursor writes the payload to stdin and reads the last JSON object on stdout; a hook that fails answers `{}`
// rather than block the turn, and inside the headless distillation every hook does nothing.
export function runHook(handle) {
  let buffer = '';
  const finish = (output) => process.stdout.write(JSON.stringify(output ?? {}), () => process.exit(0));
  const start = async () => {
    if (isHeadlessRun()) return finish({});
    try {
      finish(await handle(parsedInput(buffer)));
    } catch {
      finish({});
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.once('end', start);
  process.stdin.once('error', start);
}
