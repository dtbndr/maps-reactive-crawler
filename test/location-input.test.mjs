import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocation } from '../dist/location-input.js';
import { runCli } from '../dist/cli.js';

const candidate={label:'Synthetic place',country:'GB',latitude:51.12345678901234,longitude:-0.123456789012345};
const resolver=async()=>({candidates:[candidate],attribution:'Synthetic source'});
test('explicit country required before lookup',async()=>{let calls=0; await assert.rejects(resolveLocation('place','',async()=>{calls++; return resolver()},async()=>0),/country/i); assert.equal(calls,0)});
test('single candidate is displayed and confirmed with exact handoff and attribution',async()=>{let shown; const result=await resolveLocation('place','GB',resolver,async(display,candidates)=>{shown=display; assert.deepEqual(candidates,[candidate]); return 0}); assert.match(shown,/GB/); assert.match(shown,/Synthetic source/); assert.deepEqual(result,{country:'GB',latitude:candidate.latitude,longitude:candidate.longitude});});
test('multiple candidates require explicit selection and cancellation is safe',async()=>{const second={...candidate,label:'Second',latitude:52}; const lookup=async()=>({candidates:[candidate,second],attribution:'Synthetic'}); assert.deepEqual(await resolveLocation('place','GB',lookup,async(_d,c)=>{assert.equal(c.length,2); return 1}),{country:'GB',latitude:52,longitude:candidate.longitude}); await assert.rejects(resolveLocation('place','GB',lookup,async()=>null),/cancel/i)});
test('country mismatch and invalid candidates rejected before selection',async()=>{let selected=false; for(const invalid of [{...candidate,country:'US'},{...candidate,latitude:100}]) await assert.rejects(resolveLocation('place','GB',async()=>({candidates:[invalid],attribution:'Synthetic'}),async()=>{selected=true;return 0}),/country|candidate/i); assert.equal(selected,false)});
test('empty result differs from resolver error',async()=>{await assert.rejects(resolveLocation('place','GB',async()=>({candidates:[],attribution:'Synthetic'}),async()=>0),/no candidates/i); await assert.rejects(resolveLocation('place','GB',async()=>{throw Error('offline')},async()=>0),/resolver.*failed/i)});
test('coordinate fixture start bypasses resolver and confirmation',async()=>{let starts=0,lookups=0; const lib={start:async()=>{starts++;return {}},resume(){},cancelCheckpoint(){},status(){},exportResults(){}}; const code=await runCli(['start','--checkpoint','x','--fixture','x','--lat','1','--lon','2','--spacing-m','500','--radius-m','1000','--cells','1','--submissions','1','--active-ms','1000'],lib,{stdout(){},stderr(){}},{resolver:async()=>{lookups++;return resolver()},select:async()=>{throw Error('unexpected')}}); assert.equal(code,0); assert.equal(starts,1); assert.equal(lookups,0)});
test('standalone location command outputs confirmed handoff without crawl',async()=>{let starts=0,output=''; const lib={start:async()=>{starts++},resume(){},cancelCheckpoint(){},status(){},exportResults(){}}; const code=await runCli(['location','--text','place','--country','GB'],lib,{stdout:s=>output+=s,stderr(){}},{resolver,select:async()=>0}); assert.equal(code,0); assert.deepEqual(JSON.parse(output),{country:'GB',latitude:candidate.latitude,longitude:candidate.longitude}); assert.equal(starts,0)});
test('standalone command rejects unavailable selection without crawl',async()=>{let starts=0,errors=''; const lib={start:async()=>{starts++},resume(){},cancelCheckpoint(){},status(){},exportResults(){}}; const code=await runCli(['location','--text','place','--country','GB'],lib,{stdout(){},stderr:s=>errors+=s},{resolver,select:async()=>null}); assert.equal(code,1); assert.match(errors,/cancel/i); assert.equal(starts,0)});
test('production standalone synthetic fixture validates and denies nonterminal selection',async()=>{const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const dir=mkdtempSync(join(tmpdir(),'location-')); try {const fixture=join(dir,'fixture.json'); writeFileSync(fixture,JSON.stringify({candidates:[candidate],attribution:'Synthetic source'})); const p=spawnSync(process.execPath,['dist/cli.js','location','--text','place','--country','GB','--fixture',fixture],{encoding:'utf8',input:'1\nyes\n'}); assert.equal(p.status,1); assert.match(p.stderr,/selection cancelled/i);} finally {rmSync(dir,{recursive:true,force:true})}});

test('real terminal numbers candidates and confirms the exact selected row', async () => {
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path'); const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'location-pty-'));
 try {
  const fixture=join(dir,'fixture.json');
  const second={label:'Second synthetic',country:'GB',latitude:52.98765432109876,longitude:-1.23456789012345};
  const run=(mode,candidates)=>{writeFileSync(fixture,JSON.stringify({candidates,attribution:'Synthetic source'})); return spawnSync('/usr/bin/python3',['test/helpers/location-cli-pty.py',mode,process.execPath,'dist/cli.js','location','--text','place','--country','GB','--fixture',fixture],{encoding:'utf8',timeout:15000})};
  for (const [mode,candidates,chosen] of [['single',[candidate],candidate],['multiple',[candidate,second],second]]) {
   const p=run(mode,candidates); assert.equal(p.status,0,p.stdout+p.stderr);
   assert.match(p.stdout,/1\. Synthetic place \| GB \| 51\.12345678901234, -0\.123456789012345/);
   if (mode==='multiple') assert.match(p.stdout,/2\. Second synthetic \| GB \| 52\.98765432109876, -1\.23456789012345/);
   const confirmation=p.stdout.slice(p.stdout.indexOf('Selected candidate:'));
   assert.ok(p.stdout.includes('Selected candidate:')); assert.ok(confirmation.indexOf(chosen.label)>=0); assert.ok(confirmation.indexOf('GB')>=0); assert.ok(confirmation.indexOf(String(chosen.latitude))>=0); assert.ok(confirmation.indexOf(String(chosen.longitude))>=0); assert.ok(confirmation.indexOf('Only yes confirms:')>confirmation.indexOf(String(chosen.longitude)));
   assert.match(p.stdout,new RegExp(`"latitude":${chosen.latitude}`));
  }
  for (const mode of ['invalid','cancel','decline']) {const p=run(mode,[candidate,second]); assert.equal(p.status,1,p.stdout+p.stderr); assert.match(p.stdout,/Location selection cancelled/); if(mode!=='decline') assert.doesNotMatch(p.stdout,/Only yes confirms:/); assert.doesNotMatch(p.stdout,/"latitude":51\.12345678901234,"longitude"/);}
 } finally {rmSync(dir,{recursive:true,force:true})}
});

test('real terminal rejects an out-of-range candidate before affirmative prompt', async () => {
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const dir=mkdtempSync(join(tmpdir(),'location-range-'));
 try {const fixture=join(dir,'fixture.json'); writeFileSync(fixture,JSON.stringify({candidates:[candidate],attribution:'Synthetic'})); const p=spawnSync('/usr/bin/python3',['test/helpers/location-cli-pty.py','invalid',process.execPath,'dist/cli.js','location','--text','place','--country','GB','--fixture',fixture],{encoding:'utf8',timeout:15000}); assert.equal(p.status,1,p.stdout); assert.doesNotMatch(p.stdout,/Only yes confirms:/); } finally {rmSync(dir,{recursive:true,force:true})}
});
test('real terminal identifies selected candidate before affirmative prompt', async () => {
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const dir=mkdtempSync(join(tmpdir(),'location-confirm-'));
 try {const fixture=join(dir,'fixture.json'); writeFileSync(fixture,JSON.stringify({candidates:[candidate],attribution:'Synthetic'})); const p=spawnSync('/usr/bin/python3',['test/helpers/location-cli-pty.py','single',process.execPath,'dist/cli.js','location','--text','place','--country','GB','--fixture',fixture],{encoding:'utf8',timeout:15000}); assert.equal(p.status,0,p.stdout); assert.match(p.stdout,/Selected candidate: Synthetic place \| GB \| 51\.12345678901234, -0\.123456789012345\r?\nConfirm/); } finally {rmSync(dir,{recursive:true,force:true})}
});
test('rejects unassigned country before invoking resolver', async () => {
  let calls = 0;
  const resolver = async () => { calls++; return { candidates: [{label: 'Paris', country: 'FR', latitude: 48.85, longitude: 2.35}], attribution: 'OSM' }; };
  await assert.rejects(resolveLocation('Paris', 'ZZ', resolver, async () => 0));
  assert.equal(calls, 0);
  assert.deepEqual(await resolveLocation('Paris', 'FR', resolver, async () => 0), {country: 'FR', latitude: 48.85, longitude: 2.35});
  assert.equal(calls, 1);
});
