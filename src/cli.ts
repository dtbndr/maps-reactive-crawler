import { pathToFileURL } from 'node:url';
import { resolveLocation, type LocationResolver, type LocationSelection } from './location-input.js';
import { selectLocationOnTerminal } from './location-terminal.js';
import { readFileSync } from 'node:fs';
import { previewProviderInvocation, previewProviderResume } from './provider-preview.js';
import { terminalPrompt } from './terminal-prompt.js';
import { MAPS_DATASET } from './bright-data-mapping.js';
import { DurableState, validateProviderBinding, type ProviderBinding } from './durable-state.js';
import { createTraversal } from './traversal.js';
import { createBrightDataHttpCandidate } from './bright-data-http-candidate.js';
import { runSyntheticBrightData } from './durable-bright-data-submission.js';
import { projectOperatorStatus } from './operator.js';
import { cancelCheckpoint, exportResults, resume, start, status, type OperatorResumeOptions, type OperatorStartOptions } from './operator.js';

// The documented synchronous scrape acknowledgement can take one minute.
// Allow a 15-second buffer; the handoff still enforces remaining active time.
export const PROVIDER_REQUEST_MILLISECONDS = 75000;

export type CliIo = { stdout: (text: string) => void; stderr: (text: string) => void };
export type CliLibrary = {
  start: (options: OperatorStartOptions) => Promise<unknown>;
  resume: (options: OperatorResumeOptions) => Promise<unknown>;
  cancelCheckpoint: (options: { checkpoint: string }) => unknown;
  status: (options: { checkpoint: string }) => unknown;
  exportResults: (options: { checkpoint: string; format?: 'v2' }) => unknown;
};

type ParsedCommand =
  | { command: 'start'; options: Omit<OperatorStartOptions, 'onPreflight'> }
  | { command: 'resume'; options: OperatorResumeOptions }
  | { command: 'cancel'; checkpoint: string }
  | { command: 'status'; checkpoint: string }
  | { command: 'export'; checkpoint: string; format?: 'v2' };

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
  const allowed = command === 'start' ? startOptions : command === 'resume' ? resumeOptions : command === 'export' ? new Set(['checkpoint', 'format']) : new Set(['checkpoint']);
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
    throw new Error('Bright Data CLI execution is not implemented. The planned provider integration uses the direct API; MCP is optional. Independent contract and lifecycle evidence, account and dataset pricing evidence, rights evidence, and fresh invocation confirmation are required; none authorizes execution until a safe production boundary is implemented. No checkpoint was changed or provider called.');
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.length === 0) throw new Error(`Missing required option --${name}`);
    return value;
  };
  const optionalNumber = (name: string): number | undefined => values.has(name) ? strictNumber(values.get(name)!, name) : undefined;
  const requiredNumber = (name: string): number => strictNumber(required(name), name);
  const checkpoint = required('checkpoint');
  if (command === 'export') {
    const format = values.get('format');
    if (format !== undefined && format !== 'v2') throw new Error('Unsupported export format');
    return { command, checkpoint, ...(format ? { format } : {}) };
  }
  if (command === 'cancel' || command === 'status') return { command, checkpoint };
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

async function providerPreview(args: string[], io: CliIo): Promise<number> {
  const [command, ...tokens] = args;
  if (command !== 'start' && command !== 'resume') throw new Error('Unsupported provider command');
  const extra = new Map<string, string>();
  const ordinary: string[] = [command];
  for (let i = 0; i < tokens.length; i += 2) {
    const flag = tokens[i]!; const value = tokens[i + 1];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`Invalid option ${flag}`);
    if (['--provider', '--evidence', '--account', '--dataset', '--keyword', '--country', '--zoom', '--limit-per-input'].includes(flag)) {
      if (extra.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      extra.set(flag, value);
    } else {
      if (flag === '--fixture') throw new Error('Fixture cannot be combined with provider');
      ordinary.push(flag, value);
    }
  }
  if (extra.get('--provider') !== 'bright-data') throw new Error('Unsupported provider');
  const required = (name: string): string => { const value = extra.get(name); if (!value) throw new Error(`Missing required option ${name}; direct API use (MCP optional) requires contract and lifecycle, pricing, rights and confirmation; execution is not implemented`); return value; };
  const evidencePath = required('--evidence');
  const account = required('--account'); const dataset = required('--dataset');
  if (dataset !== MAPS_DATASET) throw new Error('Unsupported Maps dataset');
  ordinary.push('--fixture', 'unused');
  const parsed = parseArgs(ordinary);
  if (parsed.command !== 'start' && parsed.command !== 'resume') throw new Error('Unsupported provider command');
  let geometry; let limits; let binding: ProviderBinding; let resumeDetails;
  if (parsed.command === 'start') {
    geometry = parsed.options.geometry; limits = parsed.options.limits;
    binding = validateProviderBinding({ version: 2, mode: 'bright-data', keyword: required('--keyword'), country: required('--country'), zoom: strictNumber(required('--zoom'), 'zoom'), limitPerInput: strictNumber(required('--limit-per-input'), 'limit-per-input') });
  } else {
    if (['--keyword', '--country', '--zoom', '--limit-per-input'].some(flag => extra.has(flag))) throw new Error('Resume query and request settings are bound to checkpoint');
    resumeDetails = previewProviderResume(parsed.options.checkpoint, parsed.options.limits);
    geometry = resumeDetails.geometry; limits = resumeDetails.limits;
    binding = resumeDetails.binding;
  }
  let record: unknown;
  try { record = JSON.parse(readFileSync(evidencePath, 'utf8')); } catch { throw new Error('Cannot read valid evidence record'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid evidence record');
  const value = record as Record<string, unknown>;
  const preview = previewProviderInvocation({ invocation: { operation: command, query: { keyword: binding.keyword, country: binding.country }, geometry, limits, account, dataset, zoom: binding.zoom, limitPerInput: binding.limitPerInput }, evidence: value.evidence, estimate: value.estimate });
  if (preview.kind === 'blocked') throw new Error(preview.reason);
  const display = JSON.stringify({ notice: 'Direct API use; MCP is optional. Estimate is not a quote or cost cap; evidence is operator attestation, not independent verification. Local abort does not cancel remote work.', ...preview, ...(resumeDetails ? { resume: resumeDetails } : {}) }, null, 2);
  if (!await terminalPrompt(display)) throw new Error('Confirmation requires fresh affirmative terminal input; declined or unavailable. No checkpoint changed or provider called.');
  const key = process.env.BRIGHT_DATA_API_KEY;
  if (!key) throw new Error('Missing BRIGHT_DATA_API_KEY');
  let state: DurableState | undefined;
  try {
    if (parsed.command === 'start') {
      DurableState.createBound(parsed.options.checkpoint, binding, createTraversal(geometry, limits));
      state = DurableState.openBound(parsed.options.checkpoint, binding);
    } else {
      state = DurableState.openProviderGuarded(parsed.options.checkpoint, binding, parsed.options.limits ?? {}, resumeDetails!.fingerprint);
      if (parsed.options.limits && Object.keys(parsed.options.limits).length) state.writeTraversal({ ...state.readTraversal(), limits });
    }
    const now = Date.now();
    const deadline = now + Math.max(0, limits.activeTime - state.readTraversal().activeTime);
    const transport = createBrightDataHttpCandidate(key, PROVIDER_REQUEST_MILLISECONDS);
    const outcome = await runSyntheticBrightData(state, transport, { requestMilliseconds: PROVIDER_REQUEST_MILLISECONDS, activeUntil: deadline, observationDeadline: deadline, maxObservations: 20, credential: key });
    state.releaseOwner();
    io.stdout(`${JSON.stringify({ version: 1, command, status: projectOperatorStatus(state.readTraversalSnapshot()), reason: outcome.reason })}\n`);
    return 0;
  } catch {
    throw new Error('Provider execution failed; inspect checkpoint locally. No automatic resend is safe.');
  } finally { state?.close(); }
}

export async function runCli(args: string[], library: CliLibrary, io: CliIo, location?: { resolver: LocationResolver; select: LocationSelection }): Promise<number> {
  try {
    if (args[0] === 'location') {
      const values = new Map<string, string>();
      for (let i = 1; i < args.length; i += 2) {
        const flag = args[i]!; const value = args[i + 1];
        if (!['--text', '--country', '--fixture'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error('Invalid location option');
        values.set(flag, value);
      }
      if (!values.get('--country')) throw new Error('Missing required option --country');
      if (!values.get('--text')) throw new Error('Missing required option --text');
      if (!location && values.has('--fixture')) {
        const path = values.get('--fixture')!;
        location = { resolver: async () => JSON.parse(readFileSync(path, 'utf8')), select: selectLocationOnTerminal };
      }
      if (!location) throw new Error('Location resolver unavailable; specify a synthetic --fixture');
      const result = await resolveLocation(values.get('--text')!, values.get('--country')!, location.resolver, location.select);
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (args.includes('--provider')) return await providerPreview(args, io);
    const parsed = parseArgs(args);
    let result: unknown;
    if (parsed.command === 'start') {
      result = await library.start({ ...parsed.options, onPreflight: configuration => {
        io.stderr(`${JSON.stringify({ version: 1, type: 'preflight', geometry: configuration.geometry, limits: configuration.limits })}\n`);
      } });
    } else if (parsed.command === 'resume') result = await library.resume(parsed.options);
    else if (parsed.command === 'cancel') result = library.cancelCheckpoint({ checkpoint: parsed.checkpoint });
    else if (parsed.command === 'status') result = library.status({ checkpoint: parsed.checkpoint });
    else result = library.exportResults({ checkpoint: parsed.checkpoint, ...(parsed.format ? { format: parsed.format } : {}) });
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
