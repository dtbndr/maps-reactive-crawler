// Isolated candidate: not exported by the package or reachable from the CLI.
// A local abort does not establish that a submitted job stopped remotely.
import { mapDiscoveryRequest } from './bright-data-mapping.js';

type MappedRequest = ReturnType<typeof mapDiscoveryRequest>;
type ProviderResponse = { status: number; body: unknown; retryAfter?: string };
const origin = 'https://api.brightdata.com';

export function createBrightDataHttpCandidate(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch) {
  if (!key || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('Invalid transport configuration');
  async function send(path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<ProviderResponse> {
    if (signal?.aborted) throw new Error('Provider request aborted');
    const controller = new AbortController();
    let cancel: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(origin + path, { method, redirect: 'error', headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
          const retry = response.headers.get('retry-after');
          const retryAfter = retry !== null && /^\d{1,9}$/.test(retry) ? retry : undefined;
          // Never expose provider error bodies in diagnostics or persistence.
          const value: unknown = response.status === 200 || response.status === 202 ? await response.json() : null;
          return { status: response.status, body: value, ...(retryAfter === undefined ? {} : { retryAfter }) };
        })(),
        new Promise<never>((_, reject) => {
          cancel = () => { controller.abort(); reject(new Error('Provider request aborted')); };
          signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(cancel, timeoutMs);
          if (signal?.aborted) cancel();
        }),
      ]);
    } catch { throw new Error('Provider request failed or timed out'); }
    finally { if (timer !== undefined) clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel); }
  }
  function checkedId(id: string): string {
    // Restrict IDs to a single opaque path segment; other formats are unsupported.
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error('Unsupported snapshot identifier');
    return id;
  }
  return {
    async submit(request: MappedRequest, signal?: AbortSignal): Promise<ProviderResponse> {
      if ('kind' in request || request.method !== 'POST' || request.path !== '/datasets/v3/scrape') throw new Error('Unsupported submission contract');
      const item = request.body?.input?.[0];
      if (!item || request.body.input.length !== 1) throw new Error('Unsupported submission contract');
      const canonical = mapDiscoveryRequest({country:item.country, keyword:item.keyword, lat:item.lat, lon:item.long, zoom:item.zoom_level, limit:request.body.limit_per_input});
      if ('kind' in canonical || JSON.stringify(request) !== JSON.stringify(canonical)) throw new Error('Unsupported submission contract');
      return send(`${canonical.path}?${new URLSearchParams(canonical.query)}`, 'POST', canonical.body, signal);
    },
    async observe(id: string, signal?: AbortSignal): Promise<ProviderResponse> { return send(`/datasets/v3/progress/${checkedId(id)}`, 'GET', undefined, signal); },
    async retrieve(id: string, signal?: AbortSignal): Promise<ProviderResponse> { return send(`/datasets/v3/snapshot/${checkedId(id)}?format=json`, 'GET', undefined, signal); },
  };
}
