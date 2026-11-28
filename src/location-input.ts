import { isAssignedIsoCountry } from './iso-country.js';
import { LocationSearchRefusal } from './nominatim-search.js';

export type LocationCandidate = { label: string; country: string; latitude: number; longitude: number };
export type LocationResolver = (query: string, country: string) => Promise<{ candidates: LocationCandidate[]; attribution: string }>;
export type LocationSelection = (display: string, candidates: LocationCandidate[]) => Promise<number | null>;
export async function resolveLocation(query: string, country: string, resolver: LocationResolver, select: LocationSelection): Promise<{country: string; latitude: number; longitude: number}> {
  if (!isAssignedIsoCountry(country)) throw new Error('Explicit assigned ISO two-letter uppercase country required');
  if (!query.trim()) throw new Error('Location text required');
  let result: Awaited<ReturnType<LocationResolver>>;
  try { result = await resolver(query, country); } catch (error) {
    if (error instanceof LocationSearchRefusal && (error.status === 403 || error.status === 429)) {
      throw new Error(error.status === 429 ? 'Location search HTTP 429: throttled' : 'Location search HTTP 403: denied');
    }
    throw new Error('Location resolver failed');
  }
  if (!result || !Array.isArray(result.candidates) || typeof result.attribution !== 'string' || !result.attribution.trim()) throw new Error('Invalid resolver result');
  for (const c of result.candidates) {
    if (!c || typeof c.label !== 'string' || !c.label.trim() || c.country !== country || !Number.isFinite(c.latitude) || Math.abs(c.latitude) > 90 || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180) throw new Error('Invalid candidate or country mismatch');
  }
  if (!result.candidates.length) throw new Error('No candidates found');
  const display = JSON.stringify({ country, attribution: result.attribution, candidates: result.candidates }, null, 2);
  const selected = await select(display, result.candidates);
  if (selected === null) throw new Error('Location selection cancelled');
  if (!Number.isInteger(selected) || selected < 0 || selected >= result.candidates.length) throw new Error('Invalid candidate selection');
  const candidate = result.candidates[selected]!;
  return {country, latitude: candidate.latitude, longitude: candidate.longitude};
}
