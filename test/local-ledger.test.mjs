import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { globalPackageRoots } from '../lib/local-ledger.mjs';

const PACKAGE = join('node_modules', '@evomap', 'evolver', 'package.json');

test("the global Evolver is looked for in npm's global root: beside node on POSIX, %APPDATA%\\npm first on Windows", () => {
  assert.deepEqual(globalPackageRoots({ platform: 'darwin', execPath: '/opt/homebrew/bin/node', env: {} }), [join('/opt/homebrew/bin', '..', 'lib', PACKAGE)]);
  assert.deepEqual(globalPackageRoots({ platform: 'win32', execPath: '/nodejs/node.exe', env: { APPDATA: '/Users/me/AppData/Roaming' } }), [
    join('/Users/me/AppData/Roaming', 'npm', PACKAGE),
    join('/nodejs', PACKAGE),
  ]);
});
