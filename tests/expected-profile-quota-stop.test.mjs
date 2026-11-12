import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discoverExpectedProfiles} from '../src/expected-profile-discovery-v3.47.0.js';
const stamp=Date.parse('2026-10-10T09:00:00Z');
const source={snapshotId:'registered:quota',date:'2026-10-11',raceName:'アイルランドトロフィー',officialHorsePage:'https://www.jra.go.jp/keiba/race/097/horse.html',names:['カムニャック'],ages:{'カムニャック':4}};
const html='<h1>2026年10月11日 アイルランドトロフィー</h1><h3><a href="https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002022105040/40">カムニャック</a></h3><p>牝4歳 調教師：調教師（栗東） 父：種牡馬 母：母馬 母の父：母父</p>';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const f=(a=[])=>({bind(...a){return f(a)},async first(){return sql.prepare(q).get(...a)||null},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return f()},async batch(ss){return Promise.all(ss.map(s=>s.run()))}};return{sql,db}}
test('profile-link batch and discovery receipts stop all SQL after quota without masking the original error',async()=>{
 for(const phase of ['links','success-receipt','failure-receipt'])for(const kind of ['flag','message']){
  const {sql,db}=fixture();let stopped=false,requests=0;const after=[];
  const failure=Error(kind==='message'?'D1_ERROR: exceeded D1 database daily row read limit':'budget exhausted');if(kind==='flag')failure.d1DailyReadLimit=true;
  const wrapped={prepare(q){
   if(stopped){after.push(q);throw Error('SQL after quota');}
   const f=(args=[])=>({bind(...args){return f(args)},async first(){return db.prepare(q).bind(...args).first()},async run(){
    if(phase!=='links'&&q.startsWith('INSERT OR REPLACE INTO lab_expected_profile_discovery')){stopped=true;throw failure;}
    return db.prepare(q).bind(...args).run();
   }});return f();
  },async batch(ss){if(phase==='links'){stopped=true;throw failure;}return Promise.all(ss.map(s=>s.run()))}};
  await assert.rejects(discoverExpectedProfiles(wrapped,source,{now:()=>stamp,fetcher:async()=>{requests++;return phase==='failure-receipt'?new Response('',{status:403}):new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})}}),e=>e===failure);
  assert.deepEqual(after,[]);assert.equal(requests,1);
  const gate=sql.prepare('SELECT locked_until,next_batch_at FROM lab_history_collection_budget').get();assert.equal(gate.locked_until,stamp+120000);assert.equal(gate.next_batch_at,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_jra_profile_links').get().n,phase==='success-receipt'?1:0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_profile_discovery').get().n,0);sql.close();
 }
});
