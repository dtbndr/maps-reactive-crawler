import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../dist/cli.js';

test('provider start and resume disclose direct API and remain blocked without touching the library', async () => {
  for (const command of ['start', 'resume']) {
    let calls = 0;
    let stderr = '';
    const library = new Proxy({}, { get: () => () => { calls++; throw new Error('unexpected'); } });
    const code = await runCli([command, '--provider', 'bright-data'], library, {
      stdout: () => assert.fail('unexpected output'), stderr: text => { stderr += text; },
    });
    assert.equal(code, 1);
    assert.match(stderr, /direct API/i);
    assert.match(stderr, /not implemented/i);
    assert.equal(calls, 0);
  }
});
