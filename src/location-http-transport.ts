import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const maxResponseBytes = 1024 * 1024;

// This transport makes one request, never follows redirects, and waits for local socket closure.
export async function locationHttpTransport(url: string, options: { headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  const target = new URL(url);
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Invalid Search endpoint');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0, status = 0, ended = false;
    let failure: Error | undefined;
    let socketSeen = false, socketClosed = false, requestClosed = false;
    const complete = () => {
      if (!requestClosed || (socketSeen && !socketClosed)) return;
      options.signal.removeEventListener('abort', abort);
      if (failure || !ended) { reject(failure ?? new Error('Search response terminated prematurely')); return; }
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) as unknown });
    };
    const req = request(target, { method: 'GET', headers: options.headers, agent: false });
    const abort = () => { failure ??= new Error('Search attempt aborted'); req.destroy(failure); };
    req.on('socket', socket => { socketSeen = true; socket.once('close', () => { socketClosed = true; complete(); }); });
    req.on('response', response => {
      status = response.statusCode ?? 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxResponseBytes) { failure ??= new Error('Search response too large'); req.destroy(failure); return; }
        chunks.push(chunk);
      });
      response.on('end', () => { ended = true; });
      response.on('error', error => { failure ??= error; });
      response.on('aborted', () => { failure ??= new Error('Search response aborted'); });
    });
    req.on('error', error => { failure ??= error; });
    req.on('close', () => { requestClosed = true; complete(); });
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort(); else req.end();
  });
}
