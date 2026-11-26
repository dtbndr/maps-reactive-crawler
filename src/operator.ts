import { createHash } from 'node:crypto';
import { validateGeometry, type GeometryInput } from './index.js';
import { createTraversal, type DiscoveryResult, type TraversalLimits } from './traversal.js';

export type OperatorConfig = { geometry: GeometryInput; limits: TraversalLimits };
export type SyntheticFixture = {
  version: 1;
  discoveries: Record<string, { id: string; observationId: string }>;
  observations: Record<string, { result: DiscoveryResult; elapsed: number }>;
};
export type ParsedSyntheticFixture = SyntheticFixture & { identity: string };

function exactObject(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label} fields`);
}

export function validateOperatorConfig(config: OperatorConfig): OperatorConfig {
  exactObject(config, ['geometry', 'limits'], 'operator configuration');
  exactObject(config.geometry, ['seed', 'spacing', 'area'], 'geometry');
  exactObject(config.geometry.seed, ['latitude', 'longitude'], 'seed coordinate');
  if (config.geometry.area?.type === 'bbox') exactObject(config.geometry.area, ['type', 'south', 'north', 'west', 'east'], 'bbox');
  else if (config.geometry.area?.type === 'radius') exactObject(config.geometry.area, ['type', 'radius'], 'radius');
  else throw new Error('Invalid area');
  exactObject(config.limits, ['cells', 'submissions', 'activeTime'], 'limits');
  validateGeometry(config.geometry);
  createTraversal(config.geometry, config.limits);
  return config;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// JSON.parse does not expose duplicate object keys, so parse containers explicitly
// while delegating primitive/string decoding to its strict JSON grammar.
function parseUniqueJson(source: string): JsonValue {
  let offset = 0;
  const whitespace = (): void => { while (offset < source.length && /[ \t\n\r]/.test(source[offset]!)) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      if (source[offset] === '\\') { offset += 2; continue; }
      if (source[offset++] === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    throw new Error('Malformed JSON string');
  };
  const value = (): JsonValue => {
    whitespace();
    if (source[offset] === '{') {
      offset++; whitespace(); const object: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
      if (source[offset] === '}') { offset++; return object; }
      for (;;) {
        whitespace(); if (source[offset] !== '"') throw new Error('Malformed JSON object key');
        const key = string(); if (Object.hasOwn(object, key)) throw new Error(`Duplicate JSON key: ${key}`);
        whitespace(); if (source[offset++] !== ':') throw new Error('Malformed JSON object');
        object[key] = value(); whitespace();
        const separator = source[offset++]; if (separator === '}') return object;
        if (separator !== ',') throw new Error('Malformed JSON object');
      }
    }
    if (source[offset] === '[') {
      offset++; whitespace(); const array: JsonValue[] = [];
      if (source[offset] === ']') { offset++; return array; }
      for (;;) { array.push(value()); whitespace(); const separator = source[offset++]; if (separator === ']') return array; if (separator !== ',') throw new Error('Malformed JSON array'); }
    }
    if (source[offset] === '"') return string();
    const start = offset;
    while (offset < source.length && !/[ \t\n\r,}\]]/.test(source[offset]!)) offset++;
    if (start === offset) throw new Error('Malformed JSON value');
    return JSON.parse(source.slice(start, offset)) as JsonValue;
  };
  const result = value(); whitespace();
  if (offset !== source.length) throw new Error('Trailing JSON data');
  return result;
}

function validateDiscoveryResult(result: unknown): asserts result is DiscoveryResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid discovery result');
  const item = result as Record<string, unknown>;
  if (item.status === 'empty' || item.status === 'unrecognized') {
    exactObject(item, ['status'], 'discovery result'); return;
  }
  if (item.status === 'failed') {
  if (Object.keys(item).some(key => !['status', 'cause', 'scope'].includes(key)) || typeof item.scope !== 'string' || !['isolated', 'global'].includes(item.scope) || (item.cause !== undefined && typeof item.cause !== 'string')) throw new Error('Invalid failed discovery result');
    return;
  }
  if (item.status !== 'success' || Object.keys(item).some(key => !['status', 'candidates'].includes(key)) || !Array.isArray(item.candidates)) throw new Error('Invalid discovery result');
  for (const candidate of item.candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid discovery candidate');
    const value = candidate as Record<string, unknown>;
    if (Object.keys(value).some(key => !['id', 'coordinate', 'verifiedCanonicalKey'].includes(key)) || typeof value.id !== 'string' || !value.id.trim()) throw new Error('Invalid discovery candidate');
    if (value.coordinate !== undefined && value.coordinate !== null) {
      const coordinate = value.coordinate as Record<string, unknown>;
      if (!coordinate || typeof coordinate !== 'object' || Array.isArray(coordinate)) throw new Error('Invalid candidate coordinate');
      exactObject(coordinate, ['latitude', 'longitude'], 'candidate coordinate');
      if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) throw new Error('Invalid candidate coordinate');
    }
    if (value.verifiedCanonicalKey !== undefined && typeof value.verifiedCanonicalKey !== 'string') throw new Error('Invalid verified candidate key');
  }
}

export function parseSyntheticFixture(bytes: Uint8Array): ParsedSyntheticFixture {
  if (!(bytes instanceof Uint8Array)) throw new Error('Fixture must be bytes');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = parseUniqueJson(source);
  exactObject(parsed, ['version', 'discoveries', 'observations'], 'fixture');
  if (parsed.version !== 1) throw new Error('Unsupported fixture version');
  if (!parsed.discoveries || typeof parsed.discoveries !== 'object' || Array.isArray(parsed.discoveries) || !parsed.observations || typeof parsed.observations !== 'object' || Array.isArray(parsed.observations)) throw new Error('Invalid fixture mappings');
  const discoveries = parsed.discoveries as Record<string, unknown>;
  const observations = parsed.observations as Record<string, unknown>;
  const idsByWork = new Map<string, Set<string>>();
  for (const [workId, value] of Object.entries(discoveries)) {
    if (!workId.trim()) throw new Error('Invalid work ID');
    exactObject(value, ['id', 'observationId'], 'discovery');
    const { id, observationId } = value;
    if (typeof id !== 'string' || !id.trim() || typeof observationId !== 'string' || !observationId.trim() || id !== observationId || !Object.hasOwn(observations, observationId)) throw new Error('Invalid discovery observation reference');
    const ids = idsByWork.get(workId) ?? new Set<string>();
    if (ids.has(id)) throw new Error('Duplicate ID for work');
    ids.add(id); idsByWork.set(workId, ids);
  }
  for (const [observationId, value] of Object.entries(observations)) {
    exactObject(value, ['result', 'elapsed'], 'observation');
    if (!Number.isFinite(value.elapsed) || (value.elapsed as number) < 0) throw new Error('Invalid observation elapsed time');
    validateDiscoveryResult(value.result);
    if (typeof observationId !== 'string') throw new Error('Invalid observation ID');
  }
  return { version: 1, discoveries: discoveries as SyntheticFixture['discoveries'], observations: observations as SyntheticFixture['observations'], identity: createHash('sha256').update(bytes).digest('hex') };
}
