import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {captureAutomaticPrediction,readAutomaticPrediction,scheduledAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
async function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];const db={prepare(q){queries.push(q);const w=(args=[])=>({bind(...a){return w(a)},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:r.changes}}},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}}});return w()}};await ensureHistoryTable(db);
 sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER,frame_no INTEGER);INSERT INTO jra_races VALUES('2026-10-18:京都:11','2026-10-18','京都',11,'秋華賞','芝',2000,2);INSERT INTO jra_runners VALUES('2026-10-18:京都:11',1,'HorseA',3,1),('2026-10-18:京都:11',2,'HorseB',3,2)");
 for(const name of ['HorseA','HorseB'])for(const date of ['2026-09-01','2026-09-15','2026-10-18'])sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name,date,'京都','試験','芝',2000,2,12,'良','https://www.jra.go.jp/profile','2026-10-19T00:00:00Z');sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);INSERT INTO jra_race_program VALUES('2026-10-18','京都',11,'15:40','https://www.jra.go.jp/program');CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT)");queries.length=0;return{sql,db,queries}}

const target={date:'2026-10-18',venue:'京都',raceNo:11},now=Date.parse('2026-10-18T02:00:00Z');
test('automatic field prediction saves without user marks, reads exact hash, excludes same-day histories and stays immutable',async()=>{
 const {sql,db,queries}=await fixture();const a=await captureAutomaticPrediction(db,target,now);assert.equal(a.saved,1);assert.equal(a.integrityVerified,true);assert.equal(a.snapshot.runners.length,2);assert.ok(a.snapshot.runners.every(r=>Number.isFinite(r.score)&&r.mark));assert.ok(a.snapshot.histories.every(h=>h.recent.every(r=>r.date<target.date)));assert.equal(a.snapshot.guardrails.humanMarksUsed,false);
 const b=await captureAutomaticPrediction(db,target,now+86400000);assert.equal(b.saved,0);assert.equal(b.snapshotSha256,a.snapshotSha256);assert.deepEqual((await readAutomaticPrediction(db,target)).snapshot,a.snapshot);assert.equal(queries.some(q=>/lab_user_mark|lab_learning_features|lab_learning_candidates/.test(q)),false);assert.throws(()=>sql.exec('DELETE FROM lab_automatic_predictions_v1'),/immutable/);assert.throws(()=>sql.exec("UPDATE lab_automatic_predictions_v1 SET snapshot_json='{}'"),/immutable/);sql.close();
});
test('missed forecasts, missing start times, missing frames, target results and unavailable evidence are never credited',async()=>{
 for(const change of ['late','time','frame','result','history']){
 const {sql,db}=await fixture();let stamp=now;
 if(change==='late')stamp=Date.parse('2026-10-18T06:35:00Z');
 if(change==='time')sql.exec('DELETE FROM jra_race_program');
 if(change==='frame')sql.exec('UPDATE jra_runners SET frame_no=NULL');
 if(change==='result')sql.exec("INSERT INTO lab_race_outcomes VALUES('2026-10-18:京都:11',1,1)");
 if(change==='history')sql.exec('DELETE FROM jra_past_performances');
 if(change==='history'){const r=await captureAutomaticPrediction(db,target,stamp);assert.equal(r.saved,0);assert.equal(r.missingHistoryHorses.length,2)}else await assert.rejects(captureAutomaticPrediction(db,target,stamp));
 assert.equal((await readAutomaticPrediction(db,target)).available,false);sql.close();}
});
test('scheduled queue includes same-day unstarted Niigata races and records cooldown for missing evidence',async()=>{
 const {sql,db}=await fixture();sql.exec("UPDATE jra_races SET venue='新潟';UPDATE jra_race_program SET venue='新潟';DELETE FROM jra_past_performances");
 const a=await scheduledAutomaticPrediction(db,now);assert.equal(a.target.venue,'新潟');assert.equal(a.status,'awaiting-prior-history');assert.equal(a.saved,0);const b=await scheduledAutomaticPrediction(db,now+60000);assert.equal(b.status,'no-due-race');sql.close();
});
test('uncertain readback never reports successful save',async()=>{
 const {sql,db}=await fixture();let reads=0;const wrapped={prepare(q){if(q.startsWith('SELECT * FROM lab_automatic_predictions_v1')&&++reads>1)return{bind(){return{async first(){return null}}}};return db.prepare(q)}};
 await assert.rejects(captureAutomaticPrediction(wrapped,target,now),e=>e.saveMayHaveSucceeded===true);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_automatic_predictions_v1').get().n,1);sql.close();
});
