import {validateAutomaticReferences,readAutomaticValidation} from '../src/automatic-reference-validation.js';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {trainAutomaticReferences,readAutomaticTraining,automaticTrainingProtocol} from '../src/automatic-reference-training.js';
import {AUTOMATIC_COHORT} from '../src/automatic-learning-candidates.js';
import {sha256} from '../src/card-evidence.js';
import worker from '../src/index-v3.49.0.js';
const clock=Date.parse('2026-10-22T01:00:00Z'),period={trainingThrough:'2026-10-21',validationFrom:'2026-10-23'};
async function fixture(count=30,mutate,modelAt=()=>'recent-three-v1',shift=0){
 const sql=new DatabaseSync(':memory:'),queries=[],targets=[];const db={prepare(q){queries.push(q);const w=(a=[])=>({bind(...b){return w(b)},async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes,rows_read:0}}},async first(){return sql.prepare(q).get(...a)||null},async all(){const results=sql.prepare(q).all(...a);return{results,meta:{rows_read:results.length}}}});return w()},async batch(items){sql.exec('BEGIN');try{const results=await Promise.all(items.map(item=>item.run()));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 sql.exec('CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_automatic_predictions_v1(race_key TEXT PRIMARY KEY,race_date TEXT,snapshot_json TEXT,snapshot_sha256 TEXT,saved_at TEXT);CREATE TABLE lab_automatic_learning_candidates_v1(race_key TEXT PRIMARY KEY,prediction_sha256 TEXT,record_json TEXT,record_sha256 TEXT,created_at TEXT)');
 for(let i=0;i<count;i++){
  const t={date:i<15?'2026-10-20':'2026-10-21',venue:i%15<12?'東京':'京都',raceNo:i%15%12+1};if(shift)t.date=new Date(Date.parse(t.date+'T00:00:00Z')+shift*86400000).toISOString().slice(0,10);targets.push(t);const key=`${t.date}:${t.venue}:${t.raceNo}`,savedAt=t.date+'T01:00:00Z';
  sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(t.date,t.venue,t.raceNo,'15:00','https://www.jra.go.jp/program');
  const runners=[1,2].map(no=>({horseNo:no,horseName:'Horse'+no,score:90-no*20,rank:no,mark:no===1?'◎':'○',assessment:{components:{basicAbilityResults:90-no*20,recentPerformanceDevelopment:90-no*20,courseDistanceFit:50,ground:50}}}));
  const prediction={modelVersion:modelAt(i),card:runners.map(r=>({horse_no:r.horseNo,horse_name:r.horseName,frame_no:r.horseNo})),race:{...t,raceKey:key,runnerCount:2},savedAt,runners,guardrails:{humanMarksUsed:false,targetResultUsed:false,immutable:true}};
  const predictionBody=JSON.stringify(prediction),predictionSha256=await sha256(predictionBody);
  const label={cohort:AUTOMATIC_COHORT,raceKey:key,modelVersion:prediction.modelVersion,predictionSha256,predictionSavedAt:savedAt,createdAt:t.date+'T09:00:00Z',rows:runners.map(r=>({horseNo:r.horseNo,horseName:r.horseName,referenceScore:r.score,referenceRank:r.rank,referenceMark:r.mark,components:r.assessment.components,finishPosition:r.horseNo,finishStatus:'finished'})),guardrails:{originalScoresPreserved:true,postRaceReconstruction:false}};
  mutate?.(label,prediction,i);
  // Rehash mutated labels to test semantic checks, not only a broken checksum.
  const body=JSON.stringify(label);sql.prepare('INSERT INTO lab_automatic_predictions_v1 VALUES(?,?,?,?,?)').run(key,t.date,predictionBody,predictionSha256,savedAt);sql.prepare('INSERT INTO lab_automatic_learning_candidates_v1 VALUES(?,?,?,?,?)').run(key,predictionSha256,body,await sha256(body),label.createdAt);
 }
 queries.length=0;return{sql,db,targets,queries};
}
test('complete automatic candidates reuse shadow fitting and persist immutable, idempotent training without human marks or promotion',async()=>{
 const {sql,db,targets,queries}=await fixture();const r=await trainAutomaticReferences(db,{...period,targets},clock);assert.equal(r.saved,1);assert.equal(r.record.status,'fitted-shadow-only');assert.equal(r.record.trainingRaces,30);assert.equal(r.record.trainingDays,2);assert.ok(r.record.candidate);assert.equal(r.record.guardrails.automaticPromotion,false);assert.equal(r.record.guardrails.canReviewCandidate,false);assert.equal(r.record.guardrails.humanMarksRequired,false);assert.equal(r.createdAt,new Date(clock).toISOString());
 assert.deepEqual((await readAutomaticTraining(db,r.runSha256)).record,r.record);assert.equal((await trainAutomaticReferences(db,{...period,targets:targets.slice().reverse()},clock+1000)).saved,0);assert.throws(()=>sql.exec('DELETE FROM lab_automatic_shadow_training_v1'),/immutable/);assert.ok(!queries.some(q=>/lab_user_mark|lab_learning_features|lab_saved_reference_training/.test(q)));sql.close();
});
test('insufficient examples stay untrained with exact missing counts',async()=>{
 const {sql,db,targets}=await fixture(2);const r=await trainAutomaticReferences(db,{...period,targets},clock);assert.equal(r.record.status,'awaiting-training-data');assert.equal(r.record.candidate,null);assert.equal(r.record.remainingRaces,28);assert.equal(r.record.trainingDays,1);sql.close();
});
test('changed scores, components, model, cohort, save time, missing horses and invalid finishes are rejected before training writes',async()=>{
 const changes=[l=>l.rows[0].referenceScore++,l=>l.rows[0].components={...l.rows[0].components,ground:99},l=>l.modelVersion='wrong',l=>l.cohort='saved-pre-race-reference-v1',l=>l.predictionSavedAt='2026-10-19T00:00:00Z',l=>l.rows.pop(),l=>l.rows[0].finishPosition=0];
 for(const change of changes){const {sql,db,targets}=await fixture(2,(l,p,i)=>{if(i===0)change(l)});await assert.rejects(trainAutomaticReferences(db,{...period,targets},clock));assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='lab_automatic_shadow_training_v1'").get().n,0);sql.close();}
});
test('future/duplicate targets and retrospective validation periods fail before reading training records',async()=>{
 const {sql,db,targets,queries}=await fixture(2);for(const input of [{...period,targets:[targets[0],targets[0]]},{...period,targets:[{...targets[0],date:'2026-10-22'}]},{...period,validationFrom:'2026-10-22',targets},{...period,trainingThrough:'2026-10-22',targets}])await assert.rejects(trainAutomaticReferences(db,input,clock));assert.equal(queries.length,0);assert.throws(()=>automaticTrainingProtocol({trainingThrough:'2026-02-30',validationFrom:'2026-10-23'},clock));sql.close();
});
test('unauthorized and invalid HTTP methods cannot access D1; reads require validated operator authorization',async()=>{
 let calls=0;const DB={prepare(){calls++;throw Error('must not read');}};for(const method of ['GET','POST']){const r=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-training',{method}),{DB},{});assert.equal(r.status,401);}const r=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-training',{method:'DELETE'}),{DB},{});assert.equal(r.status,405);const invalid=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-training',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(24),'content-type':'application/json'},body:JSON.stringify({confirm:'TRAIN',targets:[]})}),{DB,USER_MARK_WRITE_TOKEN:'x'.repeat(24)},{});assert.equal(invalid.status,409);assert.equal(calls,0);
});
test('failed readback reports uncertain save and never retries the write',async()=>{
 const {sql,db,targets}=await fixture(2);const broken={prepare(q){if(q.startsWith('SELECT record_json,created_at FROM lab_automatic_shadow_training_v1'))return{bind(){return{first:async()=>null}}};return db.prepare(q)}};await assert.rejects(trainAutomaticReferences(broken,{...period,targets},clock),e=>e.saveMayHaveSucceeded===true);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_automatic_shadow_training_v1').get().n,1);sql.close();
});
test('individually valid candidates from different models cannot be mixed',async()=>{
 const {sql,db,targets}=await fixture(2,null,i=>i?'model-B':'model-A');await assert.rejects(trainAutomaticReferences(db,{...period,targets},clock),/異なるモデル/);assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='lab_automatic_shadow_training_v1'").get().n,0);sql.close();
});
test('authorized endpoint runs inside learning budget and independent GET reads the persisted record',async()=>{
 const {sql,db,targets}=await fixture(2),previousClock=Date.now;Date.now=()=>clock;
 try{
  const headers={authorization:'Bearer '+'x'.repeat(24),'content-type':'application/json'},env={DB:db,USER_MARK_WRITE_TOKEN:'x'.repeat(24)};
  const response=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-training',{method:'POST',headers,body:JSON.stringify({confirm:'TRAIN',...period,targets})}),env,{}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.record.status,'awaiting-training-data');assert.equal(body.saved,1);
  const read=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-training?sha256='+body.runSha256,{headers}),env,{}),saved=await read.json();assert.equal(read.status,200);assert.deepEqual(saved.record,body.record);assert.equal(saved.integrityVerified,true);
  const usage=sql.prepare("SELECT rows_read FROM lab_scheduled_read_lanes WHERE lane='learning'").get();assert.ok(usage.rows_read>0);
 }finally{Date.now=previousClock;sql.close();}
});

async function validationFixture(count=16){
 const f=await fixture(),trained=await trainAutomaticReferences(f.db,{...period,targets:f.targets},clock),future=await fixture(count,undefined,undefined,3);
 for(const table of ['jra_race_program','lab_automatic_predictions_v1','lab_automatic_learning_candidates_v1'])for(const row of future.sql.prepare('SELECT * FROM '+table).all())f.sql.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
 const targets=future.targets;future.sql.close();return{...f,trained,validationTargets:targets};
}
test('future shadow validation preserves original predictions, freezes evidence, and requires two days',async()=>{
 const f=await validationFixture(),input={runSha256:f.trained.runSha256,targets:f.validationTargets},now=Date.parse('2026-10-25T01:00:00Z');
 const before=f.sql.prepare('SELECT snapshot_json FROM lab_automatic_predictions_v1 ORDER BY race_key').all();
 const result=await validateAutomaticReferences(f.db,input,now);assert.equal(result.record.status,'ready-for-review');assert.equal(result.record.validationRaces,16);assert.equal(result.record.validationDays,2);assert.equal(result.record.guardrails.automaticPromotion,false);assert.equal(result.record.guardrails.accuracyImprovementValidated,false);assert.equal(result.record.guardrails.candidatePredictionLockedBeforeRace,false);assert.equal(result.record.baselineConcordance,1);assert.equal(result.saved,1);
 assert.equal((await validateAutomaticReferences(f.db,{...input,targets:input.targets.slice().reverse()},now+1000)).saved,0);assert.deepEqual((await readAutomaticValidation(f.db,result.validationSha256)).record,result.record);assert.deepEqual(f.sql.prepare('SELECT snapshot_json FROM lab_automatic_predictions_v1 ORDER BY race_key').all(),before);assert.throws(()=>f.sql.exec("UPDATE lab_automatic_shadow_validation_v1 SET created_at='x'"),/immutable/);
 const partial=await validateAutomaticReferences(f.db,{...input,targets:input.targets.slice(0,10)},now);assert.equal(partial.record.status,'awaiting-validation-data');assert.equal(partial.record.guardrails.canReviewCandidate,false);f.sql.close();
});
test('validation rejects training overlap, future dates, duplicates, and candidate created after predictions',async()=>{
 const f=await validationFixture(),now=Date.parse('2026-10-25T01:00:00Z'),runSha256=f.trained.runSha256;
 for(const targets of [[f.targets[0]],[f.validationTargets[0],f.validationTargets[0]],[{...f.validationTargets[0],date:'2026-10-25'}]])await assert.rejects(validateAutomaticReferences(f.db,{runSha256,targets},now));
 f.sql.exec('DROP TRIGGER automatic_training_no_update');f.sql.prepare('UPDATE lab_automatic_shadow_training_v1 SET created_at=?').run('2026-10-24T10:00:00Z');await assert.rejects(validateAutomaticReferences(f.db,{runSha256,targets:f.validationTargets},now),/学習後/);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='lab_automatic_shadow_validation_v1'").get().n,0);f.sql.close();
});
test('validation HTTP authorization and malformed input stop before DB access',async()=>{
 let calls=0;const env={DB:{prepare(){calls++;throw Error('unexpected DB access')}},USER_MARK_WRITE_TOKEN:'x'.repeat(24)};
 for(const method of ['GET','POST','DELETE']){const response=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-validation',{method}),env,{});assert.equal(response.status,method==='DELETE'?405:401);}
 const response=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-validation',{method:'POST',headers:{authorization:'Bearer '+env.USER_MARK_WRITE_TOKEN},body:JSON.stringify({confirm:'VALIDATE',targets:[]})}),env,{});assert.equal(response.status,409);assert.equal(calls,0);
});
test('authorized validation HTTP persists under budget and GET independently verifies training linkage',async()=>{
 const f=await validationFixture(),previous=Date.now;Date.now=()=>Date.parse('2026-10-25T01:00:00Z');
 try{const headers={authorization:'Bearer '+'x'.repeat(24)},env={DB:f.db,USER_MARK_WRITE_TOKEN:'x'.repeat(24)},response=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-validation',{method:'POST',headers,body:JSON.stringify({confirm:'VALIDATE',runSha256:f.trained.runSha256,targets:f.validationTargets})}),env,{}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.record.status,'ready-for-review');assert.equal(body.saved,1);
 const get=await worker.fetch(new Request('https://api.test/v1/lab/automatic-shadow-validation?sha256='+body.validationSha256,{headers}),env,{});assert.deepEqual((await get.json()).record,body.record);assert.ok(f.sql.prepare("SELECT rows_read FROM lab_scheduled_read_lanes WHERE lane='learning'").get().rows_read>0);
 }finally{Date.now=previous;f.sql.close();}
});
test('validation failed readback exposes uncertain save without retrying',async()=>{
 const f=await validationFixture(),broken={prepare(q){if(q.startsWith('SELECT record_json,created_at FROM lab_automatic_shadow_validation_v1'))return{bind(){return{first:async()=>null}}};return f.db.prepare(q)}};
 await assert.rejects(validateAutomaticReferences(broken,{runSha256:f.trained.runSha256,targets:f.validationTargets},Date.parse('2026-10-25T01:00:00Z')),e=>e.saveMayHaveSucceeded===true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM lab_automatic_shadow_validation_v1').get().n,1);f.sql.close();
});
