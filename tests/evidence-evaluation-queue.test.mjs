import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {scheduledEvidenceEvaluation} from '../src/evidence-evaluation-queue.js';import {SHADOW_POLICY} from '../src/evidence-shadow-model.js';
const now=Date.parse('2026-10-21T11:00:00Z'),model=SHADOW_POLICY.model;
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE lab_provisional_predictions_v1(race_key TEXT,snapshot_json TEXT);CREATE TABLE lab_evidence_evaluations_v1(race_key TEXT,model_version TEXT)');const db={prepare(q){const w=(a=[])=>({bind(...x){return w(x)},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return w()}};const add=(key,held)=>sql.prepare('INSERT INTO lab_provisional_predictions_v1 VALUES(?,?)').run(key,JSON.stringify({runners:[{rank:held?null:1}]}));const stored=new Map();let saves=0;const deps={save:async(db,t)=>{saves++;const k=`${t.date}:${t.venue}:${t.raceNo}`,r={available:true,integrityVerified:true,saved:1,snapshotSha256:k,snapshot:{modelVersion:model,savedAt:new Date(now).toISOString(),runners:[{newRank:1,primaryUsedRows:3}]}};stored.set(k,r);sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?)').run(k,model);return r},read:async(db,t)=>({...stored.get(`${t.date}:${t.venue}:${t.raceNo}`),saved:0})};return{sql,db,add,deps,stored,get saves(){return saves}};}
test('hourly comparison prioritizes withheld race, skips saved version and preserves old JSON',async()=>{const f=fixture();f.add('2026-10-25:京都:12',true);f.sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?)').run('2026-10-25:京都:12',model);f.add('2026-10-25:京都:10',true);f.add('2026-10-24:東京:9',false);const before=f.sql.prepare('SELECT * FROM lab_provisional_predictions_v1').all();const r=await scheduledEvidenceEvaluation(f.db,now,f.deps);assert.equal(r.target,'2026-10-25:京都:10');assert.equal(r.saved,1);assert.equal((await scheduledEvidenceEvaluation(f.db,now+10,f.deps)).status,'not-due');assert.equal((await scheduledEvidenceEvaluation(f.db,now+3600000,f.deps)).target,'2026-10-24:東京:9');assert.deepEqual(f.sql.prepare('SELECT * FROM lab_provisional_predictions_v1').all(),before);assert.equal(f.saves,2);f.sql.close();});
test('lost readback reconciles row and original hash without regenerating',async()=>{const f=fixture();f.add('2026-10-25:京都:10',true);const save=f.deps.save;f.deps.save=async(...a)=>{await save(...a);throw Object.assign(Error('lost response'),{saveMayHaveSucceeded:true})};assert.equal((await scheduledEvidenceEvaluation(f.db,now,f.deps)).status,'pending-readback');f.deps.save=async()=>{throw Error('must not regenerate')};const r=await scheduledEvidenceEvaluation(f.db,now+7200000,f.deps);assert.equal(r.status,'verified');assert.equal(r.saved,0);assert.equal(f.saves,1);f.sql.close();});
test('failure cools down one venue and another venue proceeds; past race excluded',async()=>{const f=fixture();f.add('2026-10-20:京都:1',true);f.add('2026-10-25:京都:10',true);f.add('2026-10-25:東京:10',false);const save=f.deps.save;f.deps.save=async(db,t,...a)=>{if(t.venue==='京都')throw Error('true data conflict');return save(db,t,...a)};assert.equal((await scheduledEvidenceEvaluation(f.db,now,f.deps)).status,'awaiting-data');assert.equal((await scheduledEvidenceEvaluation(f.db,now+3600000,f.deps)).target,'2026-10-25:東京:10');f.sql.close();});
test('daily quota stops without retry write after the failed operation',async()=>{const f=fixture();f.add('2026-10-25:京都:10',true);f.deps.save=async()=>{throw Object.assign(Error('quota'),{d1DailyReadLimit:true})};await assert.rejects(scheduledEvidenceEvaluation(f.db,now,f.deps),e=>e.d1DailyReadLimit);assert.equal(f.sql.prepare('SELECT status FROM lab_evidence_queue_v1').get().status,'pending-readback');f.sql.close();});
test('date window uses existing race-key indexes and preserves all three query results across JST/year boundaries',async()=>{
 const f=fixture();
 // These are the leading columns of the existing production PK/UNIQUE indexes.
 f.sql.exec('CREATE UNIQUE INDEX provisional_race_key ON lab_provisional_predictions_v1(race_key);CREATE UNIQUE INDEX evaluation_race_model ON lab_evidence_evaluations_v1(race_key,model_version);CREATE TABLE lab_evidence_queue_v1(race_key TEXT NOT NULL,model_version TEXT NOT NULL,status TEXT NOT NULL,next_at INTEGER NOT NULL,error TEXT,PRIMARY KEY(race_key,model_version))');
 const instant=Date.parse('2026-12-28T15:00:00Z'); // Dec 29 JST: eligible Dec 30 through Jan 5.
 const keys=['2026-12-29:京都:1','2026-12-30:東京:1','2027-01-05:新潟:12','2027-01-06:京都:1'];
 for(const key of keys){f.add(key,true);f.sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?)').run(key,'other-model');f.sql.prepare('INSERT INTO lab_evidence_queue_v1 VALUES(?,?,?,?,?)').run(key,model,'awaiting-data',0,null);}
 for(let i=0;i<10000;i++){
  const date=new Date(Date.UTC(2020,0,1)+Math.floor(i/36)*86400000).toISOString().slice(0,10),key=`${date}:${['東京','京都','新潟'][Math.floor(i/12)%3]}:${i%12+1}`;
  f.add(key,false);f.sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?)').run(key,model);f.sql.prepare('INSERT INTO lab_evidence_queue_v1 VALUES(?,?,?,?,?)').run(key,model,'verified',0,null);
 }
 let checked=0;const base=f.db;
 const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async run(){return base.prepare(q).bind(...args).run()},async all(){
  const result=await base.prepare(q).bind(...args).all();
  if(q.includes('race_key>=? AND race_key<?')){
   const old=q.replace('race_key>=? AND race_key<?','substr(race_key,1,10)>? AND substr(race_key,1,10)<=?'),oldArgs=args.length===3?[model,'2026-12-29','2027-01-05']:['2026-12-29','2027-01-05'];
   assert.deepEqual(result.results,f.sql.prepare(old).all(...oldArgs));
   const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+q).all(...args).map(r=>r.detail).join('\n');
   assert.match(plan,/SEARCH lab_(?:evidence|provisional)_\w+ USING (?:COVERING )?INDEX .*race_key>\? AND race_key<\?/);
   assert.ok(!f.sql.prepare('EXPLAIN QUERY PLAN '+old).all(...oldArgs).some(r=>/SEARCH lab_(?:evidence|provisional)_\w+.*race_key/.test(r.detail)));
   checked++;
  }return result;
 }});return wrap()}};
 const before=f.sql.prepare('SELECT * FROM lab_provisional_predictions_v1 ORDER BY race_key').all();
 const r=await scheduledEvidenceEvaluation(db,instant,{...f.deps,formal:async()=>null});
 assert.equal(r.target,'2026-12-30:東京:1');assert.equal(checked,3);assert.equal(f.saves,1);
 assert.deepEqual(f.sql.prepare('SELECT * FROM lab_provisional_predictions_v1 ORDER BY race_key').all(),before);
 f.sql.close();
});
