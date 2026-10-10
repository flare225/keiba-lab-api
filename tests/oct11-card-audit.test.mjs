import test from 'node:test';
import assert from 'node:assert/strict';
import {DATE,keys,inspectCoverage,inspectRunners,inspectLive} from '../scripts/audit-oct11-cards.mjs';
const programs=()=>keys.map(key=>{const [,venue,no]=key.split(':');return {program_key:key,race_date:DATE,venue,race_no:Number(no),
 race_key:key,runner_count:2,stored_runners:2,complete:true,officialCountVerified:true};});
const card=key=>({ok:true,raceKey:key,count:2,data:[{horse_name:'テストA',horse_no:1,frame_no:1},{horse_name:'テストB',horse_no:2,frame_no:1}]});
test('exact 24 Tokyo/Kyoto 1-12R must be present with audited official evidence',()=>{
 const ok=inspectCoverage({races:programs()});
 assert.equal(ok.rows.length,24);assert.equal(ok.ok,true);
 for(const venue of ['東京','京都'])for(let n=1;n<=12;n++)assert.ok(ok.rows.some(r=>r.raceKey===DATE+':'+venue+':'+n));
 const missing=inspectCoverage({races:programs().filter(x=>x.race_no!==12)});
 assert.equal(missing.ok,false);assert.equal(missing.rows.filter(x=>x.errors.includes('program-missing')).length,2);
 const fake=programs();fake[0].officialCountVerified=false;
 assert.equal(inspectCoverage({races:fake}).ok,false);
});
test('missing/duplicate horse name, horse number or frame rejects roster',()=>{
 const key=keys[0];assert.equal(inspectRunners(card(key),key,2).ok,true);
 for(const bad of [
  {data:[{horse_name:'A',horse_no:1,frame_no:null},{horse_name:'B',horse_no:2,frame_no:1}]},
  {data:[{horse_name:'A',horse_no:1,frame_no:1},{horse_name:'A',horse_no:2,frame_no:1}]},
  {data:[{horse_name:'A',horse_no:1,frame_no:1},{horse_name:'B',horse_no:3,frame_no:2}]},
 ]){
  const result=inspectRunners({...card(key),...bad},key,2);assert.equal(result.ok,false);
 }
 assert.equal(inspectRunners(card(key),keys[1],2).ok,false);
 assert.equal(inspectRunners(card(key),key,3).ok,false);
});
test('live verification is read-only, checks all 24 keys, and rejects unverified evidence',async()=>{
 const calls=[],audit={stage:'all-race-storage-audit',from:DATE,to:DATE,races:programs()};
 const reply=async path=>{
  calls.push(path);
  return path.startsWith('/v1/lab/storage-audit')?audit:card(decodeURIComponent(path.split('race_key=')[1]));
 };
 const r=await inspectLive(reply);
 assert.equal(r.ok,true);assert.equal(calls.length,25);
 assert.ok(calls.every(x=>x.startsWith('/v1/lab/storage-audit?')||x.startsWith('/api/jra/runners?')));
 audit.races[0].officialCountVerified=false;
 assert.equal((await inspectLive(reply)).ok,false);
});
