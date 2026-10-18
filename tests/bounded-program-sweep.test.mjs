import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {runScheduledFast} from '../src/fast-rotation-v3.8.1.js';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const w=(args=[])=>({bind(...a){return w(a)},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:r.changes}}},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}}});return w()}};return{sql,db}}
const stamp=Date.parse('2026-10-18T13:00:00Z');
test('hourly legacy entry now fetches one program day only, never bulk cards',async()=>{
 const {sql,db}=fixture();let calls=0;const seen=[];
 for(let i=0;i<8;i++){
 const r=await runScheduledFast({scheduledTime:stamp+i*3600000},{DB:db},{},{now:()=>stamp+i*3600000,today:()=> '2026-10-18',stage:async request=>{calls++;const u=new URL(request.url);assert.equal(u.pathname,'/v1/lab/program-stage');seen.push(u.searchParams.get('date'));return Response.json({ok:true,raceCount:36})},ingest:()=>assert.fail('old bulk ingestion must not run')});assert.equal(r.externalRequests,1);
 }
 assert.equal(calls,8);assert.equal(new Set(seen).size,8);sql.close();
});
test('403/429/503 on one program page pauses every subsequent calendar/card request',async()=>{
 for(const status of [403,429,503]){const {sql,db}=fixture();let calls=0;
 const deps={now:()=>stamp,stage:async()=>{calls++;return Response.json({ok:false,httpStatus:status,error:'source blocked'})}};
 const r=await runScheduledFast({scheduledTime:stamp},{DB:db},{},deps);assert.equal(r.ok,false);assert.equal(Date.parse(r.nextBatchAt),stamp+3600000);
 const next=await runScheduledFast({scheduledTime:stamp+60000},{DB:db},{},{...deps,now:()=>stamp+60000});assert.equal(next.status,'cooldown');assert.equal(next.externalRequests,0);assert.equal(calls,1);sql.close();}
});
test('active profile lease also blocks hourly publication discovery',async()=>{
 const {sql,db}=fixture();sql.exec("CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,locked_until INTEGER,next_batch_at INTEGER,lock_token TEXT)");sql.prepare('INSERT INTO lab_history_collection_budget VALUES(?,?,?,?)').run('jra-history',stamp+120000,0,'profile-job');
 const r=await runScheduledFast({scheduledTime:stamp},{DB:db},{},{now:()=>stamp,stage:()=>assert.fail('must honor profile lease')});assert.equal(r.externalRequests,0);assert.equal(r.status,'cooldown');sql.close();
});
