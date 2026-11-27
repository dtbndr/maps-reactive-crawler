import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const mode of ['yes', 'no', 'buffered']) {
  test(`terminal prompt PTY: ${mode}`, () => {
    const run = spawnSync('python3', ['test/terminal-prompt-pty.py', mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
  });
}

test('terminal prompt denies non-TTY streams', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "import {terminalPrompt} from './dist/terminal-prompt.js'; console.log(await terminalPrompt('PREVIEW'));"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'false');
});
