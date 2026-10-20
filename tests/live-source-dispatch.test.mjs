import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {dispatchLiveSources,collectLiveHistory,preferOfficialCards} from '../src/live-source-dispatch.js';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes}}}});return w()}};return{sql,db}}
const start=Date.parse('2026-10-19T00:12:00Z');
test('live dispatcher cannot starve results when card/history queue never empties',async()=>{
 const {sql,db}=fixture();let stamp=start;const seen=[];
 const deps={now:()=>stamp,archive:async()=>{seen.push('archive');return{ok:true,status:'idle',externalRequests:0}},results:async()=>{seen.push('results');return{ok:true,status:'collected',externalRequests:1}},history:async()=>{seen.push('history');return{ok:true,status:'cooldown',externalRequests:0}}};
 for(let i=0;i<6;i++){await dispatchLiveSources({cron:'*/3 * * * *',scheduledTime:stamp},{DB:db},deps);stamp+=360000;}
 assert.deepEqual(seen,['archive','results','history','archive','results','history']);assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_bounded_pipeline_runs WHERE job='results'").get().n,2);sql.close();
});
test('history priorities stop at shared cooldown without calling another source',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{programs:async()=>null,registered:async()=>[],cards:async()=>({status:'cooldown',externalRequests:0}),main:()=>assert.fail('must stop'),upcoming:()=>assert.fail('must stop'),expected:()=>assert.fail('must stop'),details:()=>assert.fail('must stop')});assert.equal(r.status,'cooldown');
});
test('ordinary card priority lives inside history lane and requests the coming week',async()=>{
 let called=false;const r=await collectLiveHistory({}, {scheduledTime:start},{programs:async()=>null,registered:async()=>[],cards:async(_,input)=>{assert.equal(input.includeFuture,true);assert.equal(input.upcomingOnly,true);called=true;return{status:'official-card-saved',externalRequests:1}},main:()=>assert.fail('one source batch only')});assert.equal(called,true);assert.equal(r.externalRequests,1);
});
test('idle history can enrich prior details without running a second source batch',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{programs:async()=>null,registered:async()=>[],cards:async()=>({status:'complete',externalRequests:0}),main:async()=>null,upcoming:async()=>null,expected:async()=>({status:'idle',externalRequests:0}),details:async(_,deps)=>{assert.equal(typeof deps.now,'function');return{status:'collected',externalRequests:1}}});assert.equal(r.externalRequests,1);
});

test('saved upcoming registration history is attempted before unpublished card discovery',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{programs:async()=>null,registered:async()=>[{names:['A']}],expected:async()=>({status:'collected',attempted:1,externalRequests:1}),cards:()=>assert.fail('roster history must not wait for a numbered card')});assert.equal(r.externalRequests,1);
});

test('published-card priority cannot be starved by a busy registered history queue',async()=>{
 const rosters=[{date:'2026-10-24',venue:'東京',raceNo:9},{date:'2026-10-25',venue:'京都',raceNo:11}];
 assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-20T04:00:00Z')),false);assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-22T04:59:59Z')),false);assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-22T05:00:00Z')),true);
 const r=await collectLiveHistory({}, {scheduledTime:Date.parse('2026-10-22T05:00:00Z')},{programs:async()=>null,now:()=>Date.parse('2026-10-22T05:00:00Z'),registered:async()=>rosters,cards:async()=>({status:'official-card-saved',externalRequests:1}),expected:()=>assert.fail('ready cards take priority over pending histories'),main:()=>assert.fail('one external batch only')});assert.equal(r.externalRequests,1);
});
test('card cooldown in publication window cannot fall through to a second source request',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:0},{programs:async()=>null,now:()=>Date.parse('2026-10-23T04:00:00Z'),registered:async()=>[{date:'2026-10-24'}],cards:async()=>({status:'cooldown',externalRequests:0}),expected:()=>assert.fail('respect shared gate')});assert.equal(r.status,'cooldown');
});
test('program recovery uses only its source slot and other history work resumes on the next invocation',async()=>{
 let first=true,cards=0;const deps={programs:async()=>first?(first=false,{ok:false,status:'source-unconfirmed',externalRequests:1}):null,registered:async()=>[],cards:async()=>{cards++;return{ok:true,status:'official-card-saved',externalRequests:1}}};
 const a=await collectLiveHistory({}, {scheduledTime:start},deps);assert.equal(a.status,'source-unconfirmed');assert.equal(cards,0);const b=await collectLiveHistory({}, {scheduledTime:start+3600000},deps);assert.equal(b.status,'official-card-saved');assert.equal(cards,1);
});
