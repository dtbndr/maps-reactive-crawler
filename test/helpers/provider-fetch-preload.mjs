import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.SYNTHETIC_CALLS, JSON.stringify({url, method:options.method, body:options.body && JSON.parse(options.body)}) + '\n');
  if (process.env.SYNTHETIC_SCENARIO === 'known-id') {
    const path = new URL(url).pathname;
    if (options.method === 'POST' && path === '/datasets/v3/scrape') return new Response(JSON.stringify({snapshot_id:'synthetic-id'}), {status:202});
    if (options.method === 'GET' && path === '/datasets/v3/progress/synthetic-id') {
      if (process.env.SYNTHETIC_PHASE === 'start') await new Promise(resolve => setTimeout(resolve, 4000));
      return new Response(JSON.stringify({status:'ready'}), {status:200});
    }
    if (options.method === 'GET' && path === '/datasets/v3/snapshot/synthetic-id') return new Response(JSON.stringify([{name:'Synthetic place',place_id:'synthetic-place'}]), {status:200});
    throw new Error('Unexpected synthetic request');
  }
  return new Response(JSON.stringify([]), {status:200, headers:{'content-type':'application/json'}});
};
