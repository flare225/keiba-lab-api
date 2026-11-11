import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {focusedRaceTarget,focusScheduleState,collectFocusedRace,runFocusedScheduled,focusedStoredSources} from '../src/focused-race-completion.js';
import {scheduledAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {scheduledSavedAutomaticSeal} from '../src/saved-automatic-seal-queue.js';
import {recoverMissingPrograms} from '../src/program-recovery.js';
import {saveExpectedRoster} from '../src/expected-roster-registry.js';
const stamp=Date.parse('2026-11-12T01:00:00Z'),target={date:'2026-11-15',venue:'京都',raceNo:11,expiresAt:'2026-11-15T06:35:00.000Z'},sourceEvent={cron:'*/3 * * * *',scheduledTime:stamp};
function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];const db={prepare(q){queries.push(q);const w=(a=[])=>({bind(...b){return w(b)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes}}}});return w()}};return{db,sql,queries};}
function gateDb({blocked=0,program=true,formal=false}={}){const queries=[];return{queries,prepare(q){queries.push(q);return{bind(...args){assert.ok(!q.includes('race_date=?')||args.join(':')==='2026-11-15:京都:11');return this},async first(){if(q.includes('lab_history_collection_budget'))return{next_batch_at:blocked,locked_until:0};if(q.includes('FROM jra_race_program'))return program?{start_time:'15:40'}:null;if(q.includes('FROM jra_races'))return formal?{race_key:'official-target'}:null;assert.fail(q)}}}};}
test('explicit scope fails closed on malformed/expired settings; no broad scheduler work',async()=>{
 assert.deepEqual(focusedRaceTarget(JSON.stringify(target)),target);
 assert.throws(()=>focusedRaceTarget('{'));assert.throws(()=>focusedRaceTarget(JSON.stringify({...target,expiresAt:'2026-11-16T00:00:00+09:00'})));
 assert.equal(focusScheduleState(target,sourceEvent,Date.parse(target.expiresAt)),'focus-expired-or-outside-window');
 const app=(await import('../src/index-v3.49.0.js')).default;let sql=0;const DB={prepare(){sql++;throw Error('must not touch D1')}};
 await app.scheduled({cron:'0,10,20,30,40,50 * * * *',scheduledTime:stamp},{DB,LAB_COMPLETION_FOCUS:JSON.stringify(target)},{});
 assert.equal(sql,0);
 const past={...target,date:'2026-10-18',expiresAt:'2026-10-18T15:35:00+09:00'};
 await app.scheduled(sourceEvent,{DB,LAB_COMPLETION_FOCUS:JSON.stringify(past)},{});assert.equal(sql,0);
});
test('real coordinator retains three source slots but defers archives/results and scopes prediction plus seal',async()=>{
 const {db,sql}=fixture();let tick=stamp,collections=0,predictions=0,seals=0;
 for(let i=0;i<6;i++){
  await runFocusedScheduled({...sourceEvent,scheduledTime:tick},{DB:db,LAB_SAVED_AUTOMATIC_LOCK:'true'},target,{now:()=>tick,predict:async(_,n,t)=>{assert.equal(n,tick);assert.deepEqual(t,target);predictions++},seal:async(_,o)=>{assert.deepEqual(o.target,target);assert.equal(o.enabled,true);seals++},collect:async(_,t)=>{assert.deepEqual(t,target);collections++;return{ok:true,status:'cooldown',externalRequests:0}}});tick+=360000;
 }
 assert.equal(collections,2);assert.equal(predictions,6);assert.equal(seals,6);
 for(const job of ['archive','results']){const rows=sql.prepare('SELECT result_json FROM lab_bounded_pipeline_runs WHERE job=?').all(job);assert.equal(rows.length,2);assert.ok(rows.every(r=>JSON.parse(r.result_json).status==='focus-background-deferred'));}sql.close();
});
test('shared safety wait exits before target plans; formal card goes only to its existing history collector',async()=>{
 const blocked=gateDb({blocked:stamp+3600000});const a=await collectFocusedRace(blocked,target,{}, {now:()=>stamp});assert.equal(a.status,'cooldown');assert.equal(blocked.queries.length,1);
 const db=gateDb({formal:true});let calls=0;const r=await collectFocusedRace(db,target,{}, {now:()=>stamp,collect:async(_,input)=>{calls++;assert.deepEqual(input,{...target,historyLimit:3,batchSize:1,storedBatchSize:2});return{status:'collected',savedRows:1,externalRequests:0}},cards:()=>assert.fail('saved card must not be refetched'),sources:()=>assert.fail('formal history needs no roster scan')});assert.equal(calls,1);assert.equal(r.historyWorkStage,'history');
});
test('ordinary prediction/LOCK failures cannot block target supplementation, but quota stops every later stage',async()=>{
 for(const phase of ['prediction','lock'])for(const quota of [false,true]){
  const calls=[],error=Object.assign(Error('stage failed'),quota?{d1DailyReadLimit:true}:{});
  const deps={now:()=>stamp,predict:async()=>{calls.push('prediction');if(phase==='prediction')throw error},seal:async()=>{calls.push('lock');if(phase==='lock')throw error},coordinate:async(e,env,o)=>o.jobs.history({}),collect:async()=>{calls.push('history');return{status:'collected',externalRequests:1}}};
  const run=runFocusedScheduled(sourceEvent,{DB:{}},target,deps);
  if(quota){await assert.rejects(run,e=>e===error);assert.deepEqual(calls,phase==='prediction'?['prediction']:['prediction','lock']);}
  else{const r=await run;assert.deepEqual(calls,['prediction','lock','history']);assert.equal(r.stageErrors[0].stage,phase);}
 }
});
test('target-only card/history handoff cannot fall through to another race or netkeiba roster',async()=>{
 const db=gateDb(),calls=[];
 const deps={now:()=>stamp,shared:true,sources:async(_,t)=>{assert.deepEqual(t,target);return[]},expected:async(_,o)=>{calls.push('history');assert.deepEqual(o.sources,[]);return{status:'idle',externalRequests:0}},cards:async(_,input)=>{calls.push('card');assert.equal(input.date,target.date);assert.equal(input.venue,target.venue);assert.equal(input.raceNo,11);return{status:'confirmed-predraw-saved',attempted:true,externalRequests:1}}};
 const first=await collectFocusedRace(db,target,{},deps);assert.equal(first.historyWorkStage,'acquisition');assert.deepEqual(calls,['card']);
 calls.length=0;deps.expected=async()=>{calls.push('history');return{status:'collected',attempted:1,externalRequests:1}};
 const next=await collectFocusedRace(db,target,{previousHistoryWorkStage:first.historyWorkStage},deps);assert.equal(next.historyWorkStage,'history');assert.deepEqual(calls,['history']);
 deps.expected=async()=>({status:'idle',externalRequests:0});deps.cards=async()=>({status:'card-discovery-not-due',externalRequests:0});
 assert.equal((await collectFocusedRace(db,target,{},deps)).status,'focus-awaiting-jra-card-or-profiles');
});
test('missing target program preserves exact date and a shared wait without inspecting other dates',async()=>{
 const db=gateDb({program:false});let called=0;
 const r=await collectFocusedRace(db,target,{}, {now:()=>stamp,programs:async(_,o)=>{called++;assert.deepEqual(o.target,target);return{status:'cooldown',externalRequests:0}}});assert.equal(called,1);assert.equal(r.status,'cooldown');
 const f=fixture();let requests=0;const result=await recoverMissingPrograms(f.db,{now:()=>stamp,target,fetcher:async()=>{requests++;return new Response('',{status:403})}});
 assert.equal(requests,1);assert.equal(result.date,target.date);assert.deepEqual(f.sql.prepare('SELECT date FROM lab_program_recovery_v1').all().map(r=>r.date),[target.date]);assert.equal(result.meetingAbsenceInferred,false);f.sql.close();
});
test('prediction and LOCK SQL contain exact target predicates with adjacent races present',async()=>{
 const {db,sql,queries}=fixture();sql.exec(`CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER);CREATE TABLE jra_race_program(program_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT);CREATE TABLE lab_prospective_seals(race_key TEXT,model_version TEXT,track_condition TEXT,seal_kind TEXT);INSERT INTO jra_races VALUES('other','2026-11-14','東京',3,1);INSERT INTO jra_race_program VALUES('2026-11-14:東京:3','2026-11-14','東京',3,'10:00');`);
 const p=await scheduledAutomaticPrediction(db,stamp,target);assert.equal(p.status,'no-due-race');
 assert.ok(queries.some(q=>q.includes('AND r.race_date=? AND r.venue=? AND r.race_no=?')));
 const seal=await scheduledSavedAutomaticSeal(db,{enabled:true,now:()=>stamp,target});assert.equal(seal.status,'no-due-saved-prediction');assert.ok(queries.some(q=>q.includes('AND a.race_key=?')));sql.close();
});
test('stored source lookup is exact before hashing and excludes non-JRA roster from focused history',async()=>{
 const {db,sql,queries}=fixture();const base={...target,raceName:'test',kind:'expected-runners',provider:'netkeiba',sourceUrl:'https://own.netkeiba.com/race/shutuba.html?race_id=202608050411',observedAt:new Date(stamp).toISOString(),sourceText:'馬名の原典を照合するための充分な本文です。対象馬',runners:[{horseName:'対象馬',age:4}]};
 await saveExpectedRoster(db,base,stamp);sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?,?)').run('bad-other','2026-11-14:東京:3','corrupt unrelated record','bad',new Date(stamp).toISOString());
 queries.length=0;assert.deepEqual(await focusedStoredSources(db,target,stamp),[]);assert.ok(queries.some(q=>q.includes('WHERE race_key=? ORDER BY stored_at')));sql.close();
});
