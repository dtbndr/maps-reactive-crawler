import { createCachedLocationResolver } from './location-cache.js';
import type { LocationResolver } from './location-input.js';
import { createNominatimResolver } from './nominatim-search.js';
import { coordinateTransportAttempt } from './transport-attempt.js';

type SingleAttemptTransport = (url: string, options: { headers: Record<string, string>; redirect: 'error'; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const timeoutMs = 30_000;

// The transport must make one request, honor redirects and settle only after its body is fully received or terminated.
export function createGuardedLocationResolver(config: { directory: string; endpoint: string; identification: string; transport: SingleAttemptTransport }): LocationResolver {
  const resolver = createNominatimResolver({
    endpoint: config.endpoint,
    identification: config.identification,
    transport: async (url, options) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const operation = coordinateTransportAttempt(config.directory, async () => {
        if (controller.signal.aborted) throw new Error('Search attempt timed out');
        const response = await config.transport(url, { ...options, redirect: 'error', signal: controller.signal });
        // Successful response parsing remains inside the attempt lock.
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
