import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {storedHistoryStage,runPrelockBuildStages} from '../src/prelock-build-stages.js';
const calls=[['history',null,{}],['baseRank','/rank',{}],['paceStyle','/pace',{}]];
test('failed preparation stops dependent stages without retries',async()=>{
 for(const status of [403,429,503,409]){let count=0;const r=await runPrelockBuildStages(calls,async()=>{count++;return{status,data:{ok:false,error:'blocked'}}});assert.equal(count,1);assert.equal(r.blockedBy,'history');assert.equal(r.stages.baseRank.skipped,true);assert.equal(r.stages.paceStyle.blockedBy,'history');}
});
test('quota exception stops preparation and retains the failure',async()=>{
 let count=0;const r=await runPrelockBuildStages(calls,async()=>{count++;throw Error('D1 daily row read limit')});assert.equal(count,1);assert.match(r.stages.history.error,/D1 daily/);
});
test('successful preparation runs each stage once and requires explicit success',async()=>{
 const seen=[];const r=await runPrelockBuildStages(calls,async name=>{seen.push(name);return{status:200,data:{ok:true}}});assert.equal(r.blockedBy,null);assert.deepEqual(seen,['history','baseRank','paceStyle']);
 assert.equal((await runPrelockBuildStages(calls,async()=>({status:200,data:{}}))).blockedBy,'history');
});
test('stored-history preparation ignores same-day and invalid rows without external collection or writes',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,finish_position INTEGER,field_size INTEGER);INSERT INTO jra_races VALUES('race','2026-10-24','東京',11,2);INSERT INTO jra_runners VALUES('race',1,'A',3),('race',2,'B',3);INSERT INTO jra_past_performances VALUES('A','2026-10-01',1,10),('B','2026-10-24',1,10),('B','2026-10-01',0,10);`);
 let reads=0;
 const db={prepare(query){
  assert.match(query,/^SELECT/);reads++;const stmt=sql.prepare(query);
  return {bind(...args){return {async first(){return stmt.get(...args)},async all(){return {results:stmt.all(...args)}}};}};
 }};

 const input={date:'2026-10-24',venue:'東京',raceNo:11};let r=await storedHistoryStage(db,input);assert.equal(r.status,409);assert.deepEqual(r.data.missingHistoryHorses,['B']);assert.equal(r.data.externalRequests,0);assert.equal(reads,2);
 sql.prepare('INSERT INTO jra_past_performances VALUES(?,?,?,?)').run('B','2026-10-02',2,10);r=await storedHistoryStage(db,input);assert.equal(r.status,200);assert.deepEqual(r.data.shortHistoryHorses,['A','B']);assert.equal(r.data.collectionTarget,3);sql.close();
});
test('actual prelock-build route refuses missing history before invoking any legacy acquisition stage',async()=>{
 const {default:app}=await import('../src/index-v3.8.2.js');let queries=0;
 const db={prepare(query){queries++;assert.match(query,/SELECT race_key,runner_count FROM jra_races/);return{bind(){return{async first(){return null}}}}}};
 const response=await app.fetch(new Request('https://worker.test/v1/lab/prelock-build?date=2026-10-24&venue=東京&race_no=11&track=良'),{DB:db},{});const body=await response.json();assert.equal(body.ok,false);assert.equal(body.blockedBy,'history');assert.equal(body.coreFeatureAudit,null);assert.equal(body.stages.baseRank.skipped,true);assert.equal(queries,1);
});
