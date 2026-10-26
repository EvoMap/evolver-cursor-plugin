import { evolverCommands } from './commands.mjs';
import { cursorModelRunner } from './cursor-agent.mjs';
import { DISTILL_TIMEOUT_MS, distillSession } from './distiller.mjs';
import { createProxyClient } from './proxy.mjs';
import { statusReport } from './status-report.mjs';

const SEARCH_LIMIT = 5;

/** The plugin-run commands, wired to the Proxy and to this chat's own distillation candidate. */
export function pluginCommands(sessionId) {
  const proxyFetch = createProxyClient();
  return evolverCommands({
    status: () => statusReport(proxyFetch),
    search: (text) => proxyFetch('POST', '/asset/search', { text, limit: SEARCH_LIMIT }),
    distillNow: (focus) => distillSession(sessionId, {
      proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
      runModel: cursorModelRunner(),
      focus,
    }),
  });
}

/** What a typed plugin command answers in the chat, or null when the prompt is not one. */
export async function answerOfCommand(typed, sessionId) {
  const command = typed && pluginCommands(sessionId).find((candidate) => candidate.name === typed.name);
  if (!command) return null;
  const { text } = await command.handler({ args: typed.args });
  return text;
}
