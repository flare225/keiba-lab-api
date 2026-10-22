import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runScheduledFast} from '../src/fast-rotation-v3.8.1.js';
import {executeCollection} from '../src/scheduler-observability-v3.8.1.js';
const stamp=Date.parse('2026-10-22T01:00:40.972Z'),event={cron:'0 * * * *',scheduledTime:stamp};
function fixture(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 const db={prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async run(){queries.push(q);return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){queries.push(q);return sql.prepare(q).get(...a)||null},async all(){queries.push(q);return{results:sql.prepare(q).all(...a)}}});return w()}};
 sql.exec("CREATE TABLE lab_program_sweep_receipts(race_date TEXT PRIMARY KEY,checked_at INTEGER,status TEXT,http_status INTEGER)");
 sql.prepare('INSERT INTO lab_program_sweep_receipts VALUES(?,?,?,?)').run('2026-10-22',stamp-3600000,'failed',403);
 return{sql,db,queries};
}
test('legacy day selection uses separate receipts, respects 403 for one hour and does not repeat the same date hourly',async()=>{
 const {sql,db}=fixture(),seen=[];
 const deps={now:()=>stamp,today:()=> '2026-10-22',stage:async request=>{seen.push(new URL(request.url).searchParams.get('date'));return Response.json({ok:false,httpStatus:403,error:'JRA program page not available'})}};
 const first=await runScheduledFast(event,{DB:db},{},deps);assert.equal(first.date,'2026-10-23');assert.equal(first.httpStatus,403);assert.equal(Date.parse(first.nextBatchAt),stamp+3600000);
 const blocked=await runScheduledFast(event,{DB:db},{},{...deps,now:()=>stamp+60000});assert.equal(blocked.status,'cooldown');assert.equal(blocked.externalRequests,0);
 const next=await runScheduledFast(event,{DB:db},{},{...deps,now:()=>stamp+3600001});assert.equal(next.date,'2026-10-24');assert.deepEqual(seen,['2026-10-23','2026-10-24']);sql.close();
});
test('common recovery ownership stops only the competing legacy calendar, preserving scheduler audit',async()=>{
 const {sql,db,queries}=fixture();let fetches=0;
 const r=await executeCollection(event,{DB:db,LAB_COMMON_PROGRAM_RECOVERY:true},{},{now:()=>new Date(stamp),run:()=>runScheduledFast(event,{DB:db,LAB_COMMON_PROGRAM_RECOVERY:true},{},{now:()=>stamp,today:()=> '2026-10-22',stage:async()=>{fetches++;return Response.json({ok:false,httpStatus:403,error:'JRA program page not available'})}})});
 assert.equal(fetches,0);assert.equal(queries.some(q=>q.includes('lab_history_collection_budget')),false);assert.equal(r.result.status,'legacy-program-sweep-delegated');assert.equal(sql.prepare('SELECT count(*) n FROM lab_collection_runs').get().n,1);sql.close();
});
test('delegating the duplicate hourly sweep preserves an existing 403 pause without shortening it',async()=>{
 const {sql,db}=fixture();const blocked=await runScheduledFast(event,{DB:db},{},{now:()=>stamp,today:()=> '2026-10-22',stage:async()=>Response.json({ok:false,httpStatus:403})});
 const before=sql.prepare('SELECT * FROM lab_history_collection_budget').get();
 const r=await runScheduledFast(event,{DB:db,LAB_COMMON_PROGRAM_RECOVERY:true},{},{stage:()=>assert.fail('no duplicate sweep')});assert.equal(r.status,'legacy-program-sweep-delegated');
 assert.deepEqual(sql.prepare('SELECT * FROM lab_history_collection_budget').get(),before);assert.equal(Date.parse(blocked.nextBatchAt),stamp+3600000);sql.close();
});
test('delegation is opt-in and performs no source or database operation itself',async()=>{
 const r=await runScheduledFast(event,{DB:{prepare:()=>assert.fail('delegation needs no DB query')},LAB_COMMON_PROGRAM_RECOVERY:true},{},{stage:()=>assert.fail('no source')});
 assert.equal(r.externalRequests,0);assert.equal(r.status,'legacy-program-sweep-delegated');assert.deepEqual(r.runs,[]);
});
