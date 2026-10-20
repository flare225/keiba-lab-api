import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {captureAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {labelAutomaticPrediction,readAutomaticLearningCandidate,scheduledAutomaticCandidates} from '../src/automatic-learning-candidates.js';
async function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];const db={prepare(q){queries.push(q);const w=(args=[])=>({bind(...a){return w(a)},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:r.changes}}},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}}});return w()}};await ensureHistoryTable(db);
 sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER,frame_no INTEGER);INSERT INTO jra_races VALUES('2026-10-18:京都:11','2026-10-18','京都',11,'秋華賞','芝',2000,2);INSERT INTO jra_runners VALUES('2026-10-18:京都:11',1,'HorseA',3,1),('2026-10-18:京都:11',2,'HorseB',3,2)");
 for(const name of ['HorseA','HorseB'])for(const date of ['2026-09-01','2026-09-15','2026-10-18'])sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name,date,'京都','試験','芝',2000,2,12,'良','https://www.jra.go.jp/profile','2026-10-19T00:00:00Z');sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);INSERT INTO jra_race_program VALUES('2026-10-18','京都',11,'15:40','https://www.jra.go.jp/program');CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT,source_sha256 TEXT)");queries.length=0;return{sql,db,queries}}


const target={date:'2026-10-18',venue:'京都',raceNo:11},now=Date.parse('2026-10-18T02:00:00Z'),after=Date.parse('2026-10-19T00:00:00Z');
const url='https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0108202604091120261018/9E';
function results(sql){for(const [no,name] of [[1,'HorseA'],[2,'HorseB']])sql.prepare('INSERT INTO lab_race_result_details(race_key,horse_no,horse_name,finish_position,finish_status,source_url,source_sha256) VALUES(?,?,?,?,?,?,?)').run('2026-10-18:京都:11',no,name,no,'finished',url,'a'.repeat(64));}
test('automatic forecast becomes an immutable result-labelled candidate without user marks or model promotion',async()=>{
 const {sql,db,queries}=await fixture();const prediction=await captureAutomaticPrediction(db,target,now);results(sql);
 const labelled=await labelAutomaticPrediction(db,target,after);assert.equal(labelled.saved,1);assert.equal(labelled.record.rows.length,2);assert.equal(labelled.record.predictionSha256,prediction.snapshotSha256);assert.equal(labelled.record.guardrails.automaticTraining,false);assert.equal(labelled.record.guardrails.automaticPromotion,false);
 assert.deepEqual(labelled.record.rows.map(r=>[r.horseNo,r.referenceScore,r.referenceRank]),prediction.snapshot.runners.map(r=>[r.horseNo,r.score,r.rank]));
 const read=await readAutomaticLearningCandidate(db,target);assert.equal(read.labelSha256,labelled.labelSha256);assert.equal(read.integrityVerified,true);assert.equal((await labelAutomaticPrediction(db,target,after+1000)).saved,0);assert.throws(()=>sql.exec('DELETE FROM lab_automatic_learning_candidates_v1'),/immutable/);assert.equal(queries.some(q=>/lab_user_mark|lab_learning_candidates |lab_saved_reference/.test(q)),false);sql.close();
});
test('missing forecast and incomplete or early results stay unlabelled',async()=>{
 const {sql,db}=await fixture();assert.equal((await labelAutomaticPrediction(db,target,after)).status,'awaiting-pre-race-prediction');await captureAutomaticPrediction(db,target,now);
 assert.equal((await labelAutomaticPrediction(db,target,now)).status,'awaiting-result-window');assert.equal((await labelAutomaticPrediction(db,target,after)).status,'awaiting-complete-official-results');assert.equal((await readAutomaticLearningCandidate(db,target)).available,false);sql.close();
});
test('source mismatch, wrong horse and invalid finish do not produce learning candidates',async()=>{
 for(const mutation of ["UPDATE lab_race_result_details SET source_url='https://example.com/result'","UPDATE lab_race_result_details SET horse_name='Wrong' WHERE horse_no=2","UPDATE lab_race_result_details SET finish_position=0 WHERE horse_no=2","UPDATE lab_race_result_details SET source_sha256='bad'"]){const {sql,db}=await fixture();await captureAutomaticPrediction(db,target,now);results(sql);sql.exec(mutation);await assert.rejects(labelAutomaticPrediction(db,target,after));assert.equal((await readAutomaticLearningCandidate(db,target)).available,false);sql.close();}
});
test('scheduled labels process one saved forecast, then finish without revisiting it',async()=>{
 const {sql,db}=await fixture();await captureAutomaticPrediction(db,target,now);results(sql);const a=await scheduledAutomaticCandidates(db,after);assert.equal(a.saved,1);assert.equal((await scheduledAutomaticCandidates(db,after+60000)).status,'no-due-automatic-candidate');sql.close();
});
