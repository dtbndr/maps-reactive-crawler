import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrightDataHttpCandidate } from '../dist/bright-data-http-candidate.js';
import { mapDiscoveryRequest } from '../dist/bright-data-mapping.js';
const request = mapDiscoveryRequest({country:'US',keyword:'coffee',lat:1,lon:2,zoom:14,limit:10});
const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'retry-after':'10'}});
test('documented location request and progress and snapshot use fixed endpoints', async () => {
  const calls=[]; const transport=createBrightDataHttpCandidate('fake-key', 1000, async (url, init) => {calls.push([String(url),init]); return response([]);});
  await transport.submit(request); await transport.observe('abc'); await transport.retrieve('abc');
  const url=new URL(calls[0][0]); assert.equal(url.origin,'https://api.brightdata.com'); assert.equal(url.pathname,'/datasets/v3/scrape'); assert.equal(url.searchParams.get('discover_by'),'location'); assert.equal(url.searchParams.get('dataset_id'),'gd_m8ebnr0q2qlklc02fz'); assert.deepEqual(JSON.parse(calls[0][1].body),request.body); assert.equal(calls[0][1].headers.Authorization,'Bearer fake-key');
  assert.equal(calls[1][0],'https://api.brightdata.com/datasets/v3/progress/abc'); assert.equal(calls[2][0],'https://api.brightdata.com/datasets/v3/snapshot/abc?format=json');
});
test('rejects unsupported contracts without dispatch', async () => {
 let calls=0; const t=createBrightDataHttpCandidate('fake-key',100,async()=>{calls++;return response([])});
 await assert.rejects(t.submit({...request,path:'/other'})); await assert.rejects(t.observe('../bad')); await assert.rejects(t.retrieve('')); assert.equal(calls,0);
});
test('timeout aborts and diagnostics never expose credentials or provider errors', async () => {
 let signal; const t=createBrightDataHttpCandidate('fake-key',10,async (_url,init)=>{signal=init.signal; return new Promise(()=>{});});
 await assert.rejects(t.submit(request), e=>!e.message.includes('fake-key')); assert.equal(signal.aborted,true);
 const broken=createBrightDataHttpCandidate('fake-key',100,async()=>{throw Error('fake-key secret provider response')});
 await assert.rejects(broken.submit(request), e=>!e.message.includes('fake-key') && !e.message.includes('provider response'));
 const http=createBrightDataHttpCandidate('fake-key',100,async()=>response({error:'fake-key'},401)); assert.deepEqual(await http.submit(request),{status:401,body:null,retryAfter:'10'});
});
