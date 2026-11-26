import { appendFileSync } from 'node:fs';
import { runOperatorWithDependencies, parseSyntheticFixture } from '../dist/operator.js';

const [command, encoded] = process.argv.slice(2);
if (command !== 'start' && command !== 'resume') throw new Error('Expected start or resume');
const options = JSON.parse(encoded);
const fixture = parseSyntheticFixture(await import('node:fs').then(({ readFileSync }) => readFileSync(options.fixture)));
const witness = entry => appendFileSync(options.witness, `${JSON.stringify(entry)}\n`);
const result = await runOperatorWithDependencies(command, options, {
  onPreflight: configuration => witness({ type: 'preflight', configuration }),
  send: workId => { witness({ type: 'send', workId }); return { id: fixture.discoveries[workId].id }; },
  observe: id => fixture.observations[id],
});
process.stdout.write(`${JSON.stringify(result)}\n`);
