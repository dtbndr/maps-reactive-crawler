import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.SYNTHETIC_CALLS, JSON.stringify({url, method:options.method, body:options.body && JSON.parse(options.body)}) + '\n');
  return new Response(JSON.stringify([]), {status:200, headers:{'content-type':'application/json'}});
};
