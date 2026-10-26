import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readdirSync, readFileSync } from 'node:fs';

import { argumentsOf, cmdArgument, endTree, evolverCommands, isMissingExecutable, runEvolverCli, typedCommandOf } from '../lib/commands.mjs';

const commands = evolverCommands({
  status: async () => 'OK Proxy',
  search: async (text) => ({ ok: true, data: { text } }),
  distillNow: async (focus) => (focus ? { status: 'sent', data: { id: 'gene', focus } } : { status: 'nothing' }),
  runCli: async (args) => ({ kind: 'success', text: args.join(' ') }),
});
const named = (name) => commands.find((command) => command.name === `evolver-${name}`);

const COMMANDS_DIR = new URL('../commands/', import.meta.url);
const descriptionOf = (file) => /^description: (.*)$/m.exec(readFileSync(new URL(file, COMMANDS_DIR), 'utf8'))[1].replace(/^"(.*)"$/, '$1');

test('the plugin runs dsh\'s commands but evolve, and one that takes no argument declares no input hint', () => {
  assert.deepEqual(commands.map((command) => command.name), [
    'evolver-status', 'evolver-search', 'evolver-distill', 'evolver-sync', 'evolver-review', 'evolver-run', 'evolver-solidify',
  ]);
  assert.equal(named('status').input, undefined);
  assert.ok(commands.filter((command) => command.name !== 'evolver-status').every((command) => command.input.hint));
});

test('search needs text, distill says when there is nothing, and engine commands pass their arguments through', async () => {
  assert.equal((await named('search').handler({ args: [] })).kind, 'error');
  assert.match((await named('search').handler({ args: ['flaky', 'test'] })).text, /"flaky test"/);
  assert.match((await named('distill').handler({ args: [] })).text, /Nothing to distill yet/);
  assert.match((await named('distill').handler({ args: ['the', 'backoff'] })).text, /"focus": "the backoff"/);
  assert.equal((await named('run').handler({ args: ['--strategy=balanced'] })).text, 'run --strategy=balanced');
});

test('every command has a command file for the slash menu, with the same description; evolve is the dsh prompt', () => {
  const files = readdirSync(COMMANDS_DIR).sort();
  assert.deepEqual(files, [...commands.map((command) => `${command.name}.md`), 'evolver-evolve.md'].sort());
  for (const command of commands) assert.equal(descriptionOf(`${command.name}.md`), command.description);
  const evolve = readFileSync(new URL('evolver-evolve.md', COMMANDS_DIR), 'utf8');
  assert.match(evolve, /\nTake a deliberate evolution step for the current task\./);
  assert.match(evolve, /`\/evolver-distill` distills it now/);
  assert.doesNotMatch(evolve, /evolver_/);
});

test('a typed command is read with dsh quoting, a plugin namespace dropped, and only at the start of the prompt', () => {
  assert.deepEqual(typedCommandOf('/evolver-sync --scope="a b" --dry-run'), { name: 'evolver-sync', args: ['--scope=a b', '--dry-run'] });
  assert.deepEqual(typedCommandOf('/evolver:evolver-status'), { name: 'evolver-status', args: [] });
  assert.equal(typedCommandOf('please run /evolver-status'), null);
  assert.equal(typedCommandOf('/evolvers'), null);
  assert.deepEqual(argumentsOf(String.raw`--summary="two \"quoted\" words" a\ b 'c\d'`), ['--summary=two "quoted" words', 'a b', String.raw`c\d`]);
});

test('a missing evolver executable falls back to the npx package this plugin is built against', async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return file === 'evolver' ? { error: Object.assign(new Error('spawn evolver ENOENT'), { code: 'ENOENT' }) } : { error: null, output: 'synced' };
  };
  assert.deepEqual(await runEvolverCli(['sync', '--dry-run'], { run }), { kind: 'success', text: 'synced' });
  assert.deepEqual(calls[1], ['npx', '-y', '@evomap/evolver@^2.0.44', 'sync', '--dry-run']);
});

test('on Windows a failed run whose evolver `where` cannot find falls back to npx, though cmd.exe reports no ENOENT', async () => {
  const notRecognized = Object.assign(new Error('Command failed: evolver sync'), { code: 1 });
  const windows = (found) => ({ platform: 'win32', isOnPath: async () => found });
  assert.equal(await isMissingExecutable(notRecognized, 'evolver', windows(false)), true);
  assert.equal(await isMissingExecutable(notRecognized, 'evolver', windows(true)), false);
  assert.equal(await isMissingExecutable(notRecognized, 'evolver', { platform: 'darwin', isOnPath: async () => false }), false);
  assert.equal(await isMissingExecutable(null, 'evolver', windows(false)), false);

  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return file === 'evolver' ? { error: notRecognized, output: "'evolver' is not recognized" } : { error: null, output: 'synced' };
  };
  const isMissing = (error, name) => isMissingExecutable(error, name, windows(false));
  assert.deepEqual(await runEvolverCli(['sync'], { run, isMissing }), { kind: 'success', text: 'synced' });
  assert.deepEqual(calls[1], ['npx', '-y', '@evomap/evolver@^2.0.44', 'sync']);
});

test('a Windows argument reaches the npm shim as one literal argument: cmd metacharacters are escaped for cmd.exe and the shim', () => {
  assert.equal(cmdArgument('sync'), '^^^"sync^^^"');
  assert.equal(cmdArgument('a&calc'), '^^^"a^^^&calc^^^"');
  assert.equal(cmdArgument('x|y>z'), '^^^"x^^^|y^^^>z^^^"');
  assert.equal(cmdArgument('%PATH%'), '^^^"^^^%PATH^^^%^^^"');
  assert.equal(cmdArgument('say "hi"'), '^^^"say^^^ \\^^^"hi\\^^^"^^^"');
  assert.equal(cmdArgument('C:\\dir\\'), '^^^"C:\\dir\\\\^^^"');
});

test('a timed-out CLI run ends its whole tree: the process group on POSIX, taskkill /T on Windows', () => {
  const killed = [];
  endTree(4242, { platform: 'win32', killWindowsTree: (pid) => killed.push(['taskkill', pid]), signal: () => killed.push(['signal']) });
  assert.deepEqual(killed, [['taskkill', 4242]]);

  const signals = [];
  endTree(4242, { platform: 'linux', killWindowsTree: () => signals.push('taskkill'), signal: (pid, name) => signals.push(`${pid}:${name}`) });
  assert.deepEqual(signals, ['4242:SIGTERM']);
});
