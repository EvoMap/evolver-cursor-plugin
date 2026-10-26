import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { deadPid, fakeProxy, readJson, runHook, sandboxHome, waitFor, writeProxySettings } from './helpers/sandbox.mjs';

const ASSET_ID = 'sha256:40c6ec437967f3ce0a2101857736b95d2770a014f452752a9421db2bee223f37';
const LRU_ASSET = {
  asset_id: ASSET_ID,
  short_title: 'LRU cache in Node.js',
  similarity: 0.8,
  strategy: [
    'Create `lru-cache.js` exporting the cache class',
    'Back it with a `Map` so lookups stay O(1)',
    'Evict the oldest entry with `keys().next()` once over capacity',
    'Run `node --test` to confirm the eviction order',
  ],
};
const LRU_SOURCE = 'export class LruCache {\n  #entries = new Map();\n  evict() { this.#entries.delete(this.#entries.keys().next().value); }\n}\n';
const FAILED_RUN = 'not ok 1 - evicts the oldest\nAssertionError: expected 1 to equal 2\n';
const PASSED_RUN = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n';
const LRU_PROMPT = '用 Node 写一个 LRU cache，带 get/set 和淘汰';

let sandbox = null;
let proxy = null;

afterEach(async () => {
  await proxy?.close();
  sandbox?.cleanup();
  sandbox = null;
  proxy = null;
});

async function startSandbox({ assets = [LRU_ASSET], env = {} } = {}) {
  sandbox = sandboxHome();
  Object.assign(sandbox.env, env);
  proxy = await fakeProxy({ assets });
  writeProxySettings(sandbox.home, { url: proxy.url });
}

function session(id) {
  const cwd = join(sandbox.home, 'project');
  mkdirSync(cwd, { recursive: true });
  const base = { conversation_id: id, session_id: id, model: 'claude-4.5-sonnet', workspace_roots: [cwd], cursor_version: '3.27.6' };
  let turn = 0;
  const generation = () => `${id}-gen-${turn}`;
  const hook = (name, event, fields) => runHook(name, { ...base, generation_id: generation(), hook_event_name: event, ...fields }, sandbox.env);
  const tool = (name, input) => ({ tool_name: name, tool_input: input, tool_use_id: `call-${Math.random()}`, cwd });
  return {
    cwd,
    generation,
    start: () => runHook('session-start', { ...base, generation_id: '', hook_event_name: 'sessionStart', is_background_agent: false, composer_mode: 'agent' }, sandbox.env),
    prompt: (prompt, { sameTurn = false, composerMode = 'agent' } = {}) => {
      if (!sameTurn) turn += 1;
      return hook('user-prompt-submit', 'beforeSubmitPrompt', { prompt, attachments: [], ...(composerMode && { composer_mode: composerMode }) });
    },
    shell: (command, output, exitCode = 0) => hook('post-tool-use', 'postToolUse', {
      ...tool('Shell', { command, cwd }), tool_output: JSON.stringify({ output, exitCode }), duration: 12,
    }),
    shellFailed: (command, message, failureType = 'error', interrupted = false) => hook('post-tool-use-failure', 'postToolUseFailure', {
      ...tool('Shell', { command, cwd }), error_message: message, failure_type: failureType, is_interrupt: interrupted, duration: 12,
    }),
    write: async (file, content) => {
      const path = join(cwd, file);
      await hook('pre-tool-use', 'preToolUse', tool('Write', { file_path: path, content }));
      writeFileSync(path, content);
      await hook('post-tool-use', 'postToolUse', { ...tool('Write', { file_path: path, content }), tool_output: JSON.stringify({ file_path: path, success: true }) });
      await hook('after-file-edit', 'afterFileEdit', { file_path: path, edits: [{ old_string: '', new_string: content }] });
    },
    answer: (text) => hook('after-agent-response', 'afterAgentResponse', { text }),
    stop: (status = 'completed') => hook('stop', 'stop', { status, loop_count: 0 }),
    finish: async (text, status = 'completed') => {
      if (status === 'completed') await hook('after-agent-response', 'afterAgentResponse', { text });
      return hook('stop', 'stop', { status, loop_count: 0 });
    },
    end: (reason = 'user_close') => hook('session-end', 'sessionEnd', { reason, duration_ms: 1000, is_background_agent: false, final_status: 'completed' }),
  };
}

const statePath = (name) => join(sandbox.home, '.evolver', 'state', name);
const candidates = () => readJson(statePath('cursor-distill-pending.json'), {});
const agentLog = () => join(sandbox.home, 'fake-cursor-agent.log');
const agentCalls = () => readFileSync(agentLog(), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const reuseReports = () => proxy.of('/asset/reuse-result');

async function lruTurn(s) {
  const injected = await s.prompt(LRU_PROMPT);
  await s.write('lru-cache.js', LRU_SOURCE);
  await s.shell('node --test', FAILED_RUN, 1);
  await s.shell('node --test 2>&1 | tail -5', PASSED_RUN);
  await s.finish('LRU 缓存写好了，测试通过。');
  return injected;
}

async function verifiedTurn(s, prompt = 'add a retry to the uploader') {
  await s.prompt(prompt);
  await s.shell('npm test', PASSED_RUN);
  await s.finish('Retries added; npm test passes.');
}

test('a recalled strategy rides the prompt as additional_context and ends with "Apply them where they fit."', async () => {
  await startSandbox();
  const output = await session('s-recall').prompt(LRU_PROMPT);

  assert.equal(output.continue, true);
  assert.equal(output.additional_context, [
    '[Evolution Memory] LRU cache in Node.js (EvoMap network):',
    ...LRU_ASSET.strategy.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Apply them where they fit.',
  ].join('\n'));
  assert.doesNotMatch(output.additional_context, /evolver_/);
  assert.deepEqual(proxy.of('/asset/fetch'), [{ text: LRU_PROMPT }]);
});

test('an inline edit, which names no composer_mode and drops added context, is neither recalled for nor recorded', async () => {
  await startSandbox();
  const s = session('s-inline');
  assert.deepEqual(await s.prompt(LRU_PROMPT, { composerMode: null }), {});
  await s.stop();
  assert.deepEqual(proxy.of('/asset/fetch'), []);
  assert.equal(existsSync(statePath('cursor-reports-queue.jsonl')), false);
});

test('session start adds nothing to the context when Evolver is set up', async () => {
  await startSandbox();
  assert.deepEqual(await session('s-quiet').start(), {});
});

test("the turn end reports the strategy with the turn's own evidence and leaves no candidate for a reused one", async () => {
  await startSandbox();
  const s = session('s-lru');
  await lruTurn(s);

  const [report] = await waitFor(() => reuseReports());
  assert.deepEqual(report, {
    asset_id: ASSET_ID,
    outcome: 'success',
    task_id: 'cursor:s-lru:1',
    reason: 'Injected by Evolver into Cursor turn 1; applied: used; last test passed after failing earlier.',
    evidence: { tier: 'L1', applied: 'used', check: { kind: 'test', passed: true, fail_then_pass: true }, aborted: false, stage: 'immediate' },
  });
  assert.deepEqual(candidates(), {}, 'asset_reused');
});

test('a non-zero exit fails a check even when its output reads clean, and postToolUseFailure fails it too', async () => {
  await startSandbox();
  const s = session('s-exit');
  await s.prompt(LRU_PROMPT);
  await s.shell('npm test', 'done', 2);
  await s.finish('done');
  const [first] = await waitFor(() => reuseReports());
  assert.deepEqual(first.evidence.check, { kind: 'test', passed: false, fail_then_pass: false });

  const t = session('s-timeout');
  await t.prompt(LRU_PROMPT);
  await t.shellFailed('npm test', 'Command timed out after 30000ms', 'timeout');
  await t.finish('done');
  const second = await waitFor(() => reuseReports().find((report) => report.task_id === 'cursor:s-timeout:1'));
  assert.equal(second.evidence.check.passed, false);
});

test('a check the person interrupted or a command that was denied is no evidence', async () => {
  await startSandbox();
  const s = session('s-cut-check');
  await s.prompt(LRU_PROMPT);
  await s.shellFailed('npm test', 'Command was aborted', 'error', true);
  await s.shellFailed('npm test', 'denied', 'permission_denied');
  await s.finish('done');
  const [report] = await waitFor(() => reuseReports());
  assert.equal(report.evidence.check, undefined);
  assert.match(report.reason, /no check ran/);
});

test('a correction in the next prompt sends an L3 follow-up under :correction', async () => {
  await startSandbox();
  const s = session('s-fix');
  await lruTurn(s);
  await s.prompt('还是报错，不对');
  const correction = await waitFor(() => reuseReports().find((report) => report.task_id.endsWith(':correction')));
  assert.deepEqual(correction, {
    asset_id: ASSET_ID,
    outcome: 'failed',
    task_id: 'cursor:s-fix:1:correction',
    reason: "The person's next prompt read as correction of the turn that reused this strategy.",
    evidence: { tier: 'L3', applied: 'used', stage: 'correction' },
  });
});

test('the next session in the same project reports whether the edits were kept, under :retention', async () => {
  await startSandbox();
  await lruTurn(session('s-first'));
  await waitFor(() => reuseReports());
  await session('s-second').start();
  const retention = await waitFor(() => reuseReports().find((report) => report.task_id.endsWith(':retention')));
  assert.equal(retention.task_id, 'cursor:s-first:1:retention');
  assert.equal(retention.outcome, 'success');
});

test('each stop status is the turn-end reason: aborted reports aborted, error reports failed, neither leaves a candidate', async () => {
  await startSandbox();
  const cut = session('s-cut');
  await cut.prompt(LRU_PROMPT);
  await cut.shell('node --test', PASSED_RUN);
  await cut.stop('aborted');
  const aborted = await waitFor(() => reuseReports().find((report) => report.task_id === 'cursor:s-cut:1'));
  assert.equal(aborted.outcome, 'success', 'the check that passed still decides the outcome');
  assert.equal(aborted.evidence.aborted, true);
  assert.deepEqual(aborted.evidence.check, { kind: 'test', passed: true, fail_then_pass: false });

  const failed = session('s-failed');
  await failed.prompt(LRU_PROMPT);
  await failed.stop('error');
  const errored = await waitFor(() => reuseReports().find((report) => report.task_id === 'cursor:s-failed:1'));
  assert.equal(errored.outcome, 'failed');
  assert.equal(errored.evidence.aborted, false);
  assert.deepEqual(candidates(), {});
});

test('a chat closed while its turn runs reports the strategy aborted, with an empty record, once', async () => {
  await startSandbox();
  const s = session('s-gone');
  await s.prompt(LRU_PROMPT);
  await s.end('window_close');
  await s.stop('aborted');
  const [report] = await waitFor(() => reuseReports());
  assert.deepEqual(report, {
    asset_id: ASSET_ID,
    outcome: 'failed',
    task_id: 'cursor:s-gone:1',
    reason: 'Injected by Evolver into Cursor turn 1; applied: unknown; no check ran.',
    evidence: { tier: 'none', applied: 'partial', aborted: true, stage: 'immediate' },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(reuseReports().length, 1);
});

test('a turn whose stop never came is closed as an error when the next prompt arrives', async () => {
  await startSandbox();
  const s = session('s-error');
  await s.prompt(LRU_PROMPT);
  await s.prompt('continue with the README');
  const [report] = await waitFor(() => reuseReports());
  assert.equal(report.task_id, 'cursor:s-error:1');
  assert.equal(report.outcome, 'failed');
  assert.equal(report.evidence.aborted, false);
});

test("a late stop of an earlier turn closes nothing of the current one, and a repeated prompt opens no new turn", async () => {
  await startSandbox();
  const s = session('s-late');
  await s.prompt(LRU_PROMPT);
  const firstGeneration = s.generation();
  await s.prompt('also add a size getter please');
  await runHook('stop', { conversation_id: 's-late', generation_id: firstGeneration, hook_event_name: 'stop', status: 'completed', model: 'm' }, sandbox.env);
  assert.deepEqual(await s.prompt('also add a size getter please', { sameTurn: true }), {});
  await s.finish('done');
  await waitFor(() => reuseReports().length >= 1);
  assert.deepEqual(reuseReports().map((report) => report.task_id), ['cursor:s-late:1']);
  assert.equal(reuseReports()[0].outcome, 'failed', 'turn 1 never had its stop in time and closed as an error');
});

test('a reopened chat keeps counting turns after its session end, so task ids never repeat', async () => {
  await startSandbox();
  const s = session('s-resume');
  await s.prompt(LRU_PROMPT);
  await s.finish('done');
  await s.end();
  await s.prompt('用 Node 再写一个 LRU cache 的测试，覆盖淘汰顺序');
  await s.finish('done again');
  const reports = await waitFor(() => (reuseReports().length >= 2 ? reuseReports() : null));
  assert.deepEqual(reports.map((report) => report.task_id).sort(), ['cursor:s-resume:1', 'cursor:s-resume:2']);
});

test('every hook answers a JSON object on stdout', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-json');
  assert.deepEqual(await s.prompt('add a retry to the uploader'), {});
  assert.deepEqual(await s.shell('npm test', PASSED_RUN), {});
  assert.deepEqual(await s.answer('done'), {});
  assert.deepEqual(await s.stop(), {});
  assert.deepEqual(await s.end(), {});
});

test("a killed session's open strategies are reported aborted at the next session start", async () => {
  await startSandbox();
  mkdirSync(statePath(''), { recursive: true });
  writeFileSync(statePath('cursor-injected-0000000000000000.json'), JSON.stringify({
    'sha256:orphan': { turn: 4, injectedAt: Date.now(), strategyText: '1. a.', sessionId: 's-killed', pid: deadPid() },
  }));
  writeFileSync(statePath('codex-injected-0000000000000000.json'), JSON.stringify({
    'sha256:other-host': { turn: 1, injectedAt: Date.now(), strategyText: '1. a.', sessionId: 's-codex', pid: deadPid() },
  }));
  await session('s-next').start();
  const [report] = await waitFor(() => reuseReports());
  assert.equal(report.asset_id, 'sha256:orphan');
  assert.equal(report.task_id, 'cursor:s-killed:4');
  assert.deepEqual(report.evidence, { tier: 'none', applied: 'partial', aborted: true, stage: 'immediate' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(reuseReports().length, 1, "another host's ledger is left to it");
});

test('a verified turn becomes the candidate; a failed check leaves none, a later one replaces it, and a correction drops it', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-candidate');
  await s.prompt('fix the flaky upload');
  await s.shell('npm test', FAILED_RUN, 1);
  await s.finish('Still failing.');
  assert.deepEqual(candidates(), {}, 'failed_check');

  await s.prompt('explain the retry policy');
  await s.finish('It retries three times.');
  assert.deepEqual(candidates(), {}, 'no_tool_use');

  await verifiedTurn(s);
  const candidate = candidates()['s-candidate'];
  assert.equal(candidate.prompt, 'add a retry to the uploader');
  assert.deepEqual(candidate.commands, ['npm test']);
  assert.equal(candidate.answer, 'Retries added; npm test passes.');
  assert.deepEqual(candidate.model, { model: 'claude-4.5-sonnet' });
  assert.equal(candidate.turn, 3);

  await verifiedTurn(s, 'add jitter to the backoff');
  assert.equal(candidates()['s-candidate'].turn, 4);

  await s.prompt('不对，这样不行');
  assert.deepEqual(candidates(), {});
});

test('a question that only asks for an opinion keeps the candidate', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-ask');
  await verifiedTurn(s);
  await s.prompt('这样不对吧？');
  assert.ok(candidates()['s-ask']);
});

test('the session end distills its candidate once through cursor-agent, headless and outside the conversation', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-distill');
  await verifiedTurn(s);
  assert.equal(proxy.of('/conversation/distill').length, 0, 'nothing runs at turn end');
  await s.end();

  const [body] = await waitFor(() => proxy.of('/conversation/distill'));
  assert.equal(body.platform, 'cursor');
  assert.equal(body.trigger, 'session_end');
  assert.equal(body.user_prompt, 'add a retry to the uploader');
  assert.equal(body.final_answer, 'Retries added; npm test passes.');
  assert.deepEqual(body.strategy, ['Measure.', 'Back off.']);
  assert.deepEqual(body.execution, { trace: [{ command: 'npm test', exit: 0 }] });
  assert.equal(body.persist, true);
  assert.equal(body.publish, false);
  assert.equal(body.distill_usage, undefined, 'the CLI reports no token usage');
  await waitFor(() => Object.keys(candidates()).length === 0);

  const [call] = agentCalls();
  assert.equal(call.headless, '1');
  assert.deepEqual(call.args.slice(0, 6), ['-p', '--output-format', 'json', '--mode', 'ask', '--trust']);
  assert.deepEqual(call.args.slice(call.args.indexOf('--model'), call.args.indexOf('--model') + 2), ['--model', 'claude-4.5-sonnet']);
  assert.match(call.args.at(-1), /## Task\nadd a retry to the uploader/);
  assert.equal(call.args.includes('--force'), false);
});

test('a failed or unparsed distillation keeps the candidate for the next session start, which claims and distills it', async () => {
  await startSandbox({ assets: [], env: { FAKE_AGENT_ANSWER: 'not json' } });
  const s = session('s-retry');
  await verifiedTurn(s);
  await s.end();
  await waitFor(() => candidates()['s-retry']?.attempts === 1);
  assert.equal(candidates()['s-retry'].claimedBy, null);
  assert.equal(candidates()['s-retry'].closed, true);

  delete sandbox.env.FAKE_AGENT_ANSWER;
  await session('s-after').start();
  await waitFor(() => proxy.of('/conversation/distill'));
  await waitFor(() => Object.keys(candidates()).length === 0);
});

test("a killed session's candidate is claimed and distilled by the next session start; an idle one is left alone", async () => {
  await startSandbox({ assets: [] });
  const candidate = (pid, at) => ({ prompt: 'p', commands: ['npm test'], paths: [], checks: [], answer: 'a', model: { model: 'm' }, turn: 1, pid, attempts: 0, at });
  mkdirSync(statePath(''), { recursive: true });
  writeFileSync(statePath('cursor-distill-pending.json'), JSON.stringify({ 's-killed': candidate(deadPid(), 1), 's-idle': candidate(process.pid, 2) }));
  writeFileSync(statePath('codex-distill-pending.json'), JSON.stringify({ 's-codex': candidate(deadPid(), 3) }));

  await session('s-next').start();
  await waitFor(() => proxy.of('/conversation/distill'));
  await waitFor(() => !candidates()['s-killed']);
  assert.ok(candidates()['s-idle']);
  assert.equal(proxy.of('/conversation/distill').length, 1);
  assert.ok(readJson(statePath('codex-distill-pending.json'), {})['s-codex'], "another host's candidate is left to it");
});

test('inside the headless distillation every hook does nothing: no recall, no turn, no worker', async () => {
  await startSandbox({ env: { EVOLVER_HEADLESS: '1' } });
  const s = session('s-headless');
  assert.deepEqual(await s.start(), {});
  assert.deepEqual(await s.prompt(LRU_PROMPT), {});
  await s.shell('npm test', PASSED_RUN);
  await s.finish('done');
  await s.end();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(proxy.requests, []);
  assert.equal(existsSync(statePath('')), false);
});

test('a typed plugin command is answered by the hook and stops the prompt before any model sees it', async () => {
  await startSandbox();
  const s = session('s-commands');
  const status = await s.prompt('/evolver-status');
  assert.equal(status.continue, false);
  assert.match(status.user_message, /^Evolver Cursor plugin status/);

  const search = await s.prompt('/evolver-search "flaky upload" retries');
  assert.equal(search.continue, false);
  assert.match(search.user_message, /Retry with backoff/);
  assert.deepEqual(proxy.of('/asset/search'), [{ text: 'flaky upload retries', limit: 5 }]);

  assert.match((await s.prompt('/evolver-distill')).user_message, /Nothing to distill yet/);
  assert.deepEqual(proxy.of('/asset/fetch'), [], 'a command turn recalls nothing');
});

test('/evolver-distill distills this chat now through cursor-agent', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-now');
  await verifiedTurn(s);
  const answer = await s.prompt('/evolver-distill the backoff');
  assert.equal(answer.continue, false);
  assert.match(answer.user_message, /gene_test/);
  const [body] = proxy.of('/conversation/distill');
  assert.equal(body.user_prompt, 'add a retry to the uploader');
  assert.match(agentCalls()[0].args.at(-1), /Focus on: the backoff/);
  assert.deepEqual(candidates(), {});
});

test('/evolver-evolve is a prompt for the agent, recalled for like any other, and leaves the previous turn to be labelled', async () => {
  await startSandbox();
  const s = session('s-evolve');
  await lruTurn(s);
  await waitFor(() => reuseReports());
  await s.prompt('/evolver-evolve 不对的地方在哪里');
  assert.equal(proxy.of('/asset/fetch').length, 2);
  await s.finish('Reflected.');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(reuseReports().some((report) => report.task_id.endsWith(':correction')), false, 'a command is no verdict');
  await s.prompt('还是报错，不对');
  const correction = await waitFor(() => reuseReports().find((report) => report.task_id.endsWith(':correction')));
  assert.equal(correction.task_id, 'cursor:s-evolve:1:correction');
});

test('a prompt typed while the stop of the turn it aborted still runs waits for it: notes, candidate and follow-up all land', async () => {
  await startSandbox();
  const s = session('s-race');
  await s.prompt(LRU_PROMPT);
  await s.write('lru-cache.js', LRU_SOURCE);
  await s.shell('node --test', PASSED_RUN);
  await s.answer('LRU 缓存写好了。');
  await Promise.all([s.stop('completed'), s.prompt('还是报错，不对')]);
  const reports = await waitFor(() => (reuseReports().length >= 2 ? reuseReports() : null));
  const immediate = reports.find((report) => report.task_id === 'cursor:s-race:1');
  assert.equal(immediate.evidence.tier, 'L1', "the stop took the turn's notes");
  assert.ok(reports.find((report) => report.task_id === 'cursor:s-race:1:correction'));
});

test('a verified turn whose stop races a correction leaves no candidate behind', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-race-candidate');
  await s.prompt('add a retry to the uploader');
  await s.shell('npm test', PASSED_RUN);
  await s.answer('Retries added.');
  await Promise.all([s.stop('completed'), s.prompt('不对，这样不行')]);
  assert.deepEqual(candidates(), {});
});

test('a stop that arrives after its chat closed writes nothing', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-late-stop');
  await s.prompt('add a retry to the uploader');
  await s.shell('npm test', PASSED_RUN);
  await s.answer('Retries added.');
  await s.end();
  await s.stop('completed');
  assert.deepEqual(candidates(), {});
});

test('the chat on its default model, which Cursor names with an empty string, is distilled on the CLI default', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-default');
  await s.prompt('add a retry to the uploader');
  await s.shell('npm test', PASSED_RUN);
  await s.answer('Retries added.');
  await runHook('stop', { conversation_id: 's-default', generation_id: s.generation(), hook_event_name: 'stop', status: 'completed', model: '' }, sandbox.env);
  assert.deepEqual(candidates()['s-default'].model, { model: 'default' });
  await s.end();
  await waitFor(() => proxy.of('/conversation/distill'));
  assert.equal(agentCalls()[0].args.includes('--model'), false);
});

test('a backgrounded command, which Cursor fails with "Unknown error", has no verdict yet', async () => {
  await startSandbox();
  const s = session('s-bg');
  await s.prompt(LRU_PROMPT);
  await s.shellFailed('npm test', 'Unknown error');
  await s.finish('Started the suite in the background.');
  const [report] = await waitFor(() => reuseReports());
  assert.equal(report.evidence.check, undefined);
});

test('a plugin command whose CLI cannot run answers its error in the chat instead of reaching the model', async () => {
  await startSandbox({ env: { PATH: '/nonexistent' } });
  const answer = await session('s-broken').prompt('/evolver-sync');
  assert.equal(answer.continue, false);
  assert.match(answer.user_message, /\S/);
});
