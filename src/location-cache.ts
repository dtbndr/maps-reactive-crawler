import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAssignedIsoCountry } from './iso-country.js';
import type { LocationCandidate, LocationResolver } from './location-input.js';

// Internal persistence only: callers must add cross-process request coordination before use.
export function createCachedLocationResolver(config: { directory: string; endpoint: string; resolver: LocationResolver }): LocationResolver {
  const endpoint = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Search endpoint');
  return async (query, country) => {
    if (!query.trim() || !isAssignedIsoCountry(country)) throw new Error('Explicit query and country required');
    const key = createHash('sha256').update(JSON.stringify([endpoint.href, query, country])).digest('hex');
    const path = join(config.directory, `${key}.json`);
    let text: string | undefined;
    try { text = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (text !== undefined) return validate(JSON.parse(text) as unknown, country);
    const result = validate(await config.resolver(query, country), country);
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const temporary = join(config.directory, `.${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    return result;
  };
}

function validate(value: unknown, country: string): { candidates: LocationCandidate[]; attribution: string } {
  if (!value || typeof value !== 'object') throw new Error('Invalid resolver result');
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.candidates) || typeof result.attribution !== 'string' || !result.attribution.trim()) throw new Error('Invalid resolver result');
  const candidates = result.candidates.map((item: unknown): LocationCandidate => {
    if (!item || typeof item !== 'object') throw new Error('Invalid candidate');
    const c = item as Record<string, unknown>;
    if (typeof c.label !== 'string' || !c.label.trim() || c.country !== country || typeof c.latitude !== 'number' || !Number.isFinite(c.latitude) || Math.abs(c.latitude) > 90 || typeof c.longitude !== 'number' || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180) throw new Error('Invalid candidate');
    return { label: c.label, country, latitude: c.latitude, longitude: c.longitude };
  });
  return { candidates, attribution: result.attribution };
}
