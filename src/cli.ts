import { pathToFileURL } from 'node:url';
import { cancelCheckpoint, exportResults, resume, start, status, type OperatorResumeOptions, type OperatorStartOptions } from './operator.js';

export type CliIo = { stdout: (text: string) => void; stderr: (text: string) => void };
export type CliLibrary = {
  start: (options: OperatorStartOptions) => Promise<unknown>;
  resume: (options: OperatorResumeOptions) => Promise<unknown>;
  cancelCheckpoint: (options: { checkpoint: string }) => unknown;
  status: (options: { checkpoint: string }) => unknown;
  exportResults: (options: { checkpoint: string }) => unknown;
};

type ParsedCommand =
  | { command: 'start'; options: Omit<OperatorStartOptions, 'onPreflight'> }
  | { command: 'resume'; options: OperatorResumeOptions }
  | { command: 'cancel' | 'status' | 'export'; checkpoint: string };

const startOptions = new Set(['checkpoint', 'fixture', 'provider', 'lat', 'lon', 'spacing-m', 'radius-m', 'bbox', 'cells', 'submissions', 'active-ms']);
const resumeOptions = new Set(['checkpoint', 'fixture', 'provider', 'cells', 'submissions', 'active-ms']);

function strictNumber(value: string, flag: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(`Invalid number for --${flag}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid number for --${flag}`);
  return number;
}

function parseArgs(args: string[]): ParsedCommand {
  const [command, ...tokens] = args;
  if (command !== 'start' && command !== 'resume' && command !== 'cancel' && command !== 'status' && command !== 'export') throw new Error('Expected command: start, resume, cancel, status, or export');
  const allowed = command === 'start' ? startOptions : command === 'resume' ? resumeOptions : new Set(['checkpoint']);
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith('--') || token.length === 2) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown option: ${token}`);
    if (values.has(name)) throw new Error(`Duplicate option: ${token}`);
    const value = tokens[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    values.set(name, value);
  }
  if (values.has('provider')) {
    if (values.get('provider') !== 'bright-data') throw new Error('Unsupported provider');
    throw new Error('Bright Data CLI execution is not implemented. Independent contract and lifecycle evidence, account and dataset pricing evidence, rights evidence, and fresh invocation confirmation are required; none authorizes execution until a safe production boundary is implemented. No checkpoint was changed or provider called.');
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.length === 0) throw new Error(`Missing required option --${name}`);
    return value;
  };
  const optionalNumber = (name: string): number | undefined => values.has(name) ? strictNumber(values.get(name)!, name) : undefined;
  const requiredNumber = (name: string): number => strictNumber(required(name), name);
  const checkpoint = required('checkpoint');
  if (command === 'cancel' || command === 'status' || command === 'export') return { command, checkpoint };
  const fixture = required('fixture');
  if (command === 'resume') {
    const limits: NonNullable<OperatorResumeOptions['limits']> = {};
    const cells = optionalNumber('cells');
    const submissions = optionalNumber('submissions');
    const activeTime = optionalNumber('active-ms');
    if (cells !== undefined) limits.cells = cells;
    if (submissions !== undefined) limits.submissions = submissions;
    if (activeTime !== undefined) limits.activeTime = activeTime;
    return { command, options: { checkpoint, fixture, ...(Object.keys(limits).length ? { limits } : {}) } };
  }
  const radius = values.has('radius-m');
  const bbox = values.has('bbox');
  if (radius === bbox) throw new Error('Specify exactly one of --radius-m or --bbox');
  let area: OperatorStartOptions['geometry']['area'];
  if (radius) area = { type: 'radius', radius: requiredNumber('radius-m') };
  else {
    const parts = required('bbox').split(',');
    if (parts.length !== 4) throw new Error('Invalid --bbox; expected SOUTH,NORTH,WEST,EAST');
    const [south, north, west, east] = parts.map((part, index) => strictNumber(part, `bbox[${index}]`));
    area = { type: 'bbox', south: south!, north: north!, west: west!, east: east! };
  }
  return {
    command,
    options: {
      checkpoint, fixture,
      geometry: { seed: { latitude: requiredNumber('lat'), longitude: requiredNumber('lon') }, spacing: requiredNumber('spacing-m'), area },
      limits: { cells: requiredNumber('cells'), submissions: requiredNumber('submissions'), activeTime: requiredNumber('active-ms') },
    },
  };
}

export async function runCli(args: string[], library: CliLibrary, io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs(args);
    let result: unknown;
    if (parsed.command === 'start') {
      result = await library.start({ ...parsed.options, onPreflight: configuration => {
        io.stderr(`${JSON.stringify({ version: 1, type: 'preflight', geometry: configuration.geometry, limits: configuration.limits })}\n`);
      } });
    } else if (parsed.command === 'resume') result = await library.resume(parsed.options);
    else if (parsed.command === 'cancel') result = library.cancelCheckpoint({ checkpoint: parsed.checkpoint });
    else if (parsed.command === 'status') result = library.status({ checkpoint: parsed.checkpoint });
    else result = library.exportResults({ checkpoint: parsed.checkpoint });
    io.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli(process.argv.slice(2), { start, resume, cancelCheckpoint, status, exportResults }, {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  }).then(code => { process.exitCode = code; });
}
