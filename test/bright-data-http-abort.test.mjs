import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrightDataHttpCandidate} from '../dist/bright-data-http-candidate.js';
test('caller abort cancels a pending fetch; pre-abort dispatches nothing', async () => {
 let calls=0, observed; const t=createBrightDataHttpCandidate('fake-key',1000,async (_url, init)=>{calls++; observed=init.signal; return new Promise(()=>{});});
 const controller=new AbortController(); const pending=t.observe('abc',controller.signal); controller.abort(); await assert.rejects(pending); assert.equal(observed.aborted,true);
 await assert.rejects(t.observe('abc',controller.signal)); assert.equal(calls,1);
});
