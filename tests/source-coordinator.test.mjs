import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {Script} from 'node:vm';
import {runSourceCoordinator,pickSourceJob,SOURCE_CRON,LEGACY_SOURCE_CRONS} from '../src/source-coordinator-v3.40.0.js';import {pipelineStatus,pipelineHeartbeat} from '../src/pipeline-runs-v3.40.0.js';import {archivePage} from '../src/archive-page-v3.40.0.js';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}},async run(){const result=sql.prepare(q).run(...args);return{meta:{changes:Number(result.changes)}}}});return wrap()}};return{db,sql}}
const start=Date.parse('2026-10-06T08:00:00Z');
test('persisted predraw handoff survives cooldown and clears after its history turn without another state query',async()=>{
 const {db,sql}=fixture();let stamp=start;const seen=[];
 const jobs={archive:async()=>({status:'idle'}),results:async()=>({status:'idle'}),history:async context=>{
  seen.push(context.previousCardSelection?.savedPredrawHistoryPending??null);
  if(seen.length===1)return{status:'predraw-page-preserved',card:{kind:'predraw'},historyWorkStage:'acquisition',cardSelection:{lane:'card'},externalRequests:1};
  if(seen.length===2)return{status:'cooldown',externalRequests:0};
  return{status:'collected',historyWorkStage:'history',externalRequests:1,cardSelection:{...context.previousCardSelection,savedPredrawHistoryPending:false}};
 }};
 for(let i=0;i<12;i++){await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:stamp},{DB:db},{now:()=>stamp,jobs});stamp+=180000;}
 assert.deepEqual(seen,[null,true,true,false]);assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_bounded_pipeline_runs WHERE job='results'").get().n,4);sql.close();
});
test('known legacy timer rotates every official collection stage, one source job per event',async()=>{const {db,sql}=fixture();let stamp=start;const calls=[],jobs=Object.fromEntries(['archive','results','history'].map(j=>[j,async()=>{calls.push(j);return{ok:true,status:'collected',externalRequests:1}}]));for(let i=0;i<6;i++){const r=await runSourceCoordinator({cron:'5,15,25,35,45,55 * * * *',scheduledTime:stamp},{DB:db},{now:()=>stamp,jobs});assert.equal(r.externalRequests,1);stamp+=600000}assert.deepEqual(calls,['archive','results','history','archive','results','history']);const status=await pipelineStatus(db,stamp);assert.ok(status.jobs.filter(x=>!['learning'].includes(x.job)).every(x=>x.heartbeat==='observed'));assert.equal(status.jobs.find(x=>x.job==='learning').heartbeat,'not-observed');assert.equal(status.jobs.some(x=>x.job==='learning-source-track'),false);sql.close()});
test('duplicate delivery cannot choose a different job and repeat a source fetch',async()=>{const {db,sql}=fixture();const calls=[],jobs=Object.fromEntries(['archive','results','history'].map(j=>[j,async()=>{calls.push(j);return{ok:true,status:'collected',externalRequests:1}}]));const event={cron:SOURCE_CRON,scheduledTime:start};await runSourceCoordinator(event,{DB:db},{now:()=>start,jobs});assert.equal((await runSourceCoordinator(event,{DB:db},{now:()=>start,jobs})).status,'already-recorded');assert.deepEqual(calls,['archive']);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_bounded_pipeline_runs').get().n,1);sql.close()});
test('manual progress is used for fair work rotation without claiming cron execution',async()=>{const {db,sql}=fixture();let stamp=start;const jobs=Object.fromEntries(['archive','results','history'].map(j=>[j,async()=>({ok:true,status:'collected',externalRequests:1})]));await runSourceCoordinator({cron:'manual',scheduledTime:stamp},{DB:db},{trigger:'manual',now:()=>stamp,jobs});assert.equal(await pickSourceJob(db),'results');const status=await pipelineStatus(db,stamp);assert.equal(status.jobs[0].heartbeat,'not-observed');stamp+=180000;assert.equal((await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:stamp},{DB:db},{now:()=>stamp,jobs})).dispatch.job,'results');sql.close()});
test('returned source failures remain visible and do not monopolize the next event',async()=>{const {db,sql}=fixture();const jobs={archive:async()=>({ok:false,status:'failed',externalRequests:1,error:'JRA取得 HTTP 429'}),results:async()=>({ok:true,status:'cooldown',externalRequests:0}),history:async()=>({ok:true,status:'idle',externalRequests:0})};await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:start},{DB:db},{now:()=>start,jobs});const status=await pipelineStatus(db,start);assert.equal(status.jobs[0].scheduled.error,'JRA取得 HTTP 429');assert.equal(await pickSourceJob(db),'results');const next=await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:start+180000},{DB:db},{now:()=>start+180000,jobs});assert.equal(next.status,'cooldown');assert.equal(next.externalRequests,0);sql.close()});
test('source timer changes preserve recognized legacy routes and readable truthful progress',()=>{assert.ok(LEGACY_SOURCE_CRONS.includes('5,15,25,35,45,55 * * * *'));assert.equal(SOURCE_CRON,'*/3 * * * *');const page=archivePage();for(const [,script] of page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(script);assert.ok(page.includes('取得間隔の待機'));assert.ok(page.includes('自動実行はまだ未確認'));assert.ok(page.includes('3分間隔の設定'));assert.ok(page.includes('最終状態'))});

test('stale starts are not presented as healthy running jobs',()=>{
 const run={started_at:start,status:'running'};assert.equal(pipelineHeartbeat(run,start+60000),'running');assert.equal(pipelineHeartbeat(run,start+6*60000),'completion-unconfirmed');assert.equal(pipelineHeartbeat(run,start+31*60000),'overdue');assert.equal(pipelineHeartbeat({...run,status:'cooldown',finished_at:start+2000},start+60000),'observed');
});
test('fairness context reuses indexed prior history result, survives cooldown and leaves job rotation unchanged',async()=>{
 const {db,sql}=fixture();let stamp=start,seen=[];const jobs={archive:async()=>({ok:true,status:'idle',externalRequests:0}),results:async()=>({ok:true,status:'idle',externalRequests:0}),history:async context=>{seen.push(context.previousCardSelection?.lane||null);return seen.length===1?{ok:true,status:'confirmed-predraw-saved',externalRequests:1}:seen.length===2?{ok:true,status:'cooldown',externalRequests:0}:{ok:true,status:'official-card-index-found',cardSelection:{lane:'discovery'},externalRequests:1}}};
 for(let i=0;i<12;i++){await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:stamp},{DB:db},{now:()=>stamp,jobs});stamp+=600000;}
 assert.deepEqual(seen,[null,'card','card','discovery']);const plan=sql.prepare("EXPLAIN QUERY PLAN SELECT result_json FROM lab_bounded_pipeline_runs WHERE job='history' AND trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 1").all();assert.ok(plan.some(x=>/lab_pipeline_job_started/.test(x.detail)));assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_bounded_pipeline_runs').get().n,12);sql.close();
});

test('pipeline status selects latest once per group rather than once per historical run',async()=>{
 const {db,sql}=fixture();
 await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:start},{DB:db},{now:()=>start,jobs:{archive:async()=>({status:'idle'})}});
 const insert=sql.prepare('INSERT INTO lab_bounded_pipeline_runs(run_id,job,trigger_kind,started_at,status,result_json) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<2000;i++)insert.run('history'+i,'history','scheduled',start+i,'complete',JSON.stringify({n:i}));
 insert.run('tie-z','history','scheduled',start+1999,'complete',JSON.stringify({n:'tie'}));
 insert.run('manual','history','manual',start+2000,'complete',JSON.stringify({n:'manual'}));
 let query;const observed={prepare(q){query=q;return db.prepare(q)}};
 const result=await pipelineStatus(observed,start+3000);assert.equal(result.jobs.find(x=>x.job==='history').scheduled.result.n,'tie');assert.equal(result.jobs.find(x=>x.job==='history').manual.result.n,'manual');
 assert.match(query,/FROM \(SELECT DISTINCT job,trigger_kind/);
 const before=sql.prepare('SELECT p.* FROM lab_bounded_pipeline_runs p WHERE p.run_id=(SELECT q.run_id FROM lab_bounded_pipeline_runs q WHERE q.job=p.job AND q.trigger_kind=p.trigger_kind ORDER BY q.started_at DESC,q.run_id DESC LIMIT 1) ORDER BY p.job,p.trigger_kind').all();
 assert.deepEqual(sql.prepare(query).all(),before);sql.close();
});

test('source latest lookup preserves every trigger kind and missing-job fairness with accumulated history',async()=>{
 const {db,sql}=fixture();await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:start},{DB:db},{now:()=>start,jobs:{archive:async()=>({status:'idle'})}});
 const insert=sql.prepare('INSERT INTO lab_bounded_pipeline_runs(run_id,job,trigger_kind,started_at,status) VALUES(?,?,?,?,?)');
 for(let i=0;i<20000;i++)insert.run('bulk'+i,['archive','results','history','learning'][i%4],['scheduled','manual','custom'][i%3],start+i,'complete');
 let query;const observed={prepare(q){query=q;return db.prepare(q)}};
 const expected=sql.prepare("SELECT job,MAX(started_at) latest FROM lab_bounded_pipeline_runs WHERE job IN ('archive','results','history') GROUP BY job").all();
 assert.equal(await pickSourceJob(observed),'archive');assert.deepEqual(sql.prepare(query).all(),expected);
 sql.exec("DELETE FROM lab_bounded_pipeline_runs WHERE job='results'");assert.equal(await pickSourceJob(db),'results');
 sql.exec('DELETE FROM lab_bounded_pipeline_runs');assert.equal(await pickSourceJob(db),'archive');sql.close();
});

test('explicit failure read retrieves saved evidence hidden by cooldown with one indexed bounded SELECT',async()=>{
 const {db,sql}=fixture();await runSourceCoordinator({cron:SOURCE_CRON,scheduledTime:start},{DB:db},{now:()=>start,jobs:{archive:async()=>({status:'idle'})}});
 const evidence={target:{date:'2026-10-25',venue:'京都',raceNo:3},cardInspection:{problemRows:[{connectionCell:'missing age'}]}};
 const put=sql.prepare('INSERT INTO lab_bounded_pipeline_runs(run_id,job,trigger_kind,started_at,status,result_json) VALUES(?,?,?,?,?,?)');put.run('failure','history','scheduled',start+1,'deferred',JSON.stringify({error:'Not a pre-draw roster',failureEvidence:evidence}));put.run('later','history','scheduled',start+2,'cooldown','{}');
 const app=(await import('../src/index-v3.49.0.js')).default;let query,count=0;const observed={prepare(q){count++;query=q;assert.match(q,/^SELECT/);return db.prepare(q)}};
 const response=await app.fetch(new Request('https://test/v1/lab/pipeline-status?failure_job=history'),{DB:observed},{}),data=await response.json();assert.equal(response.status,200);assert.equal(data.runId,'failure');assert.deepEqual(data.failureEvidence,evidence);assert.equal(count,1);assert.equal(data.scannedRuns,2);assert.match(query,/LIMIT 32$/);
 const plan=sql.prepare('EXPLAIN QUERY PLAN '+query).all('history','scheduled').map(r=>r.detail).join(' ');assert.match(plan,/lab_pipeline_job_started/);
 count=0;assert.equal((await app.fetch(new Request('https://test/v1/lab/pipeline-status?failure_job=invalid'),{DB:observed},{})).status,400);assert.equal(count,0);
 for(let i=0;i<32;i++)put.run('new'+i,'history','scheduled',start+3+i,'cooldown','{}');const {readPipelineFailure}=await import('../src/pipeline-runs-v3.40.0.js');assert.equal((await readPipelineFailure(db,'history')).available,false);assert.equal((await readPipelineFailure(db,'history')).scannedRuns,32);sql.close();
});
