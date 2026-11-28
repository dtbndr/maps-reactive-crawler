import type { LocationCandidate, LocationResolver } from './location-input.js';

type Transport = (url: string, options: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createNominatimResolver(config: { endpoint: string; identification: string; transport: Transport }): LocationResolver {
  const endpoint = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Search endpoint');
  if (!config.identification.trim()) throw new Error('Identification required');
  return async (query, country) => {
    if (!query.trim() || !/^[A-Z]{2}$/.test(country)) throw new Error('Explicit query and country required');
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('countrycodes', country.toLowerCase());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    const response = await config.transport(url.toString(), { headers: { 'User-Agent': config.identification } });
    if (!response.ok) throw new Error('Search request failed');
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Invalid Search response');
    const candidates: LocationCandidate[] = body.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid Search candidate');
      const item = value as Record<string, unknown>;
      const address = item.address;
      const code = address && typeof address === 'object' ? (address as Record<string, unknown>).country_code : undefined;
      if (typeof item.display_name !== 'string' || !item.display_name.trim() || typeof code !== 'string' || !/^[a-z]{2}$/i.test(code) || code.toUpperCase() !== country || typeof item.lat !== 'string' || !item.lat.trim() || typeof item.lon !== 'string' || !item.lon.trim()) throw new Error('Invalid Search candidate');
      const latitude = Number(item.lat), longitude = Number(item.lon);
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Invalid Search candidate');
      return { label: item.display_name, country: code.toUpperCase(), latitude, longitude };
    });
    return { candidates, attribution: '© OpenStreetMap contributors' };
  };
}
