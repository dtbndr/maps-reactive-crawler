import { createCachedLocationResolver } from './location-cache.js';
import { locationHttpTransport } from './location-http-transport.js';
import type { LocationResolver } from './location-input.js';
import { createNominatimResolver } from './nominatim-search.js';
import { coordinateTransportAttempt } from './transport-attempt.js';

type BufferedTransport = typeof locationHttpTransport;
type Config = { directory: string; endpoint: string; identification: string };
const timeoutMs = 30_000;

export function createGuardedLocationResolver(config: Config): LocationResolver {
  return assemble(config, locationHttpTransport);
}

// Synthetic-only seam: the test transport must settle only after local termination.
export function createGuardedLocationResolverForTest(config: Config & { transport: BufferedTransport }): LocationResolver {
  return assemble(config, config.transport);
}

function assemble(config: Config, transport: BufferedTransport): LocationResolver {
  const resolver = createNominatimResolver({
    endpoint: config.endpoint,
    identification: config.identification,
    transport: async (url, options) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const operation = coordinateTransportAttempt(config.directory, async () => {
        if (controller.signal.aborted) throw new Error('Search attempt timed out');
        const response = await transport(url, { ...options, signal: controller.signal });
        const body = response.ok ? await response.json() : undefined;
        return { ok: response.ok, status: response.status, json: async () => body };
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Search attempt timed out')); }, timeoutMs);
      });
      try { return await Promise.race([operation, timeout]); } finally { clearTimeout(timer); }
    },
  });
  // Cache-key ownership is always acquired before attempt ownership, never the reverse.
  return createCachedLocationResolver({ directory: config.directory, endpoint: config.endpoint, resolver });
}
