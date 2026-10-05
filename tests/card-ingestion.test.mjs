import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{validDate,matches,validateCard,ingestDay,storageAudit} from '../src/index-v3.7.1.js';
const date='2026-10-10',url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604011120261010%2Ftest';
const meta={date,venue:'東京',raceNo:11,url};
const programs=[{program_key:`${date}:東京:11`,race_date:date,venue:'東京',race_no:11}];
const card={runnerCount:2,runners:[{horseNo:1,name:'テストア'},{horseNo:2,name:'テストイ'}]};
const env={DB:{prepare(){return{bind(){return{all:async()=>({results:programs})}}}}}};
function deps(overrides={}){return{discover:async()=>({found:new Map([[programs[0].program_key,meta]]),errors:[]}),fetchHtml:async()=>({ok:true,url,body:''}),parseRace:()=>card,persistFullDay:async(db,probe)=>{assert.equal(probe.date,date);assert.equal(probe.races.length,1);return{saved:[{raceKey:programs[0].program_key,status:'saved',runnerCount:2}]};},...overrides};}
const request=()=>new Request(`https://test/v1/lab/card-ingest?date=${date}`);
test('valid dates reject normalized and impossible calendar dates',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-99-99'),false);assert.equal(validDate(date),true);});
test('race identity includes exact requested date and venue',()=>{assert.ok(matches(meta,date,'東京',11));assert.equal(matches(meta,'2026-10-11','東京',11),false);});
test('duplicate, gapped or empty runner numbers are refused',()=>{assert.ok(validateCard(card));for(const runners of [[],[{horseNo:1,name:'ア'},{horseNo:1,name:'イ'}],[{horseNo:1,name:'ア'},{horseNo:3,name:'イ'}]])assert.equal(validateCard({...card,runners}),false);});
test('requested future date is persisted once, using confirmed saved target',async()=>{const r=await ingestDay(request(),env,{},deps());assert.ok(r.ok);assert.equal(r.storedRunners,2);});
test('redirect to another race never persists a card',async()=>{let saved=false;const r=await ingestDay(request(),env,{},deps({fetchHtml:async()=>({ok:true,url:url.replace('20261010','20261011')}),persistFullDay:async()=>{saved=true;}}));assert.equal(saved,false);assert.equal(r.ok,false);});
test('missing discovery is not reported as unpublished or successful',async()=>{const r=await ingestDay(request(),env,{},deps({discover:async()=>({found:new Map(),errors:[]})}));assert.equal(r.ok,false);assert.equal(r.runs[0].status,'card-not-discovered');});
test('save acknowledgement from another race is rejected',async()=>{const r=await ingestDay(request(),env,{},deps({persistFullDay:async()=>({saved:[{raceKey:'wrong',status:'saved',runnerCount:2}]})}));assert.equal(r.ok,false);});
test('audit compares runner rows, identifies partial cards',async()=>{
 let query=0;const db={prepare(){return{bind(){return{all:async()=>({results:query++===0?[{...programs[0],race_key:programs[0].program_key,runner_count:2,stored_runners:1,unique_runners:1,invalid_runners:0}]:[]})}}}}};
 const r=await storageAudit(db,date,date);assert.equal(r.ok,false);assert.equal(r.allCardsComplete,false);assert.equal(r.totals.runnersStored,1);assert.equal(r.totals.declaredRunners,2);
});
test('range rejects malformed dates rather than silently dropping them',async()=>{const r=await worker.fetch(new Request('https://test/v1/lab/card-ingest-range?dates=2026-10-10,invalid'),env,{});assert.equal(r.status,400);});
