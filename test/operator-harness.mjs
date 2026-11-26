import { appendFileSync } from 'node:fs';
import { runOperatorWithDependencies, parseSyntheticFixture } from '../dist/operator.js';
import { setDurableDiscoveryBoundaryHookForTest } from '../dist/durable-discovery.js';
import { setAfterTraversalWriteForTest } from '../dist/durable-state.js';

const [command, encoded] = process.argv.slice(2);
if (command !== 'start' && command !== 'resume') throw new Error('Expected start or resume');
const options = JSON.parse(encoded);
const fixture = parseSyntheticFixture(await import('node:fs').then(({ readFileSync }) => readFileSync(options.fixture)));
const witness = entry => appendFileSync(options.witness, `${JSON.stringify(entry)}\n`);
if (options.fault !== undefined && !['send-throw', 'reserved-boundary', 'dispatched-boundary', 'settlement-write'].includes(options.fault)) throw new Error('Unsupported test harness fault');
const controller = options.abortAfterSend ? new AbortController() : undefined;
if (options.fault === 'reserved-boundary' || options.fault === 'dispatched-boundary') {
  const boundaryToFault = options.fault === 'reserved-boundary' ? 'reserved' : 'dispatched';
  setDurableDiscoveryBoundaryHookForTest(boundary => { if (boundary === boundaryToFault) throw new Error(`${boundaryToFault} boundary fault`); });
}
const result = await runOperatorWithDependencies(command, options, {
  onPreflight: configuration => witness({ type: 'preflight', configuration }),
  send: workId => {
    witness({ type: 'send', workId });
    if (options.fault === 'send-throw') throw new Error('injected send fault');
    if (controller) setTimeout(() => controller.abort(), 0);
    return { id: fixture.discoveries[workId].id };
  },
  observe: id => {
    if (options.observationCalls) appendFileSync(options.observationCalls, `${id}\n`);
    if (options.fault === 'settlement-write') setAfterTraversalWriteForTest(() => { throw new Error('settlement failed'); });
    return fixture.observations[id];
  },
  ...(controller ? { signal: controller.signal } : {}),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
