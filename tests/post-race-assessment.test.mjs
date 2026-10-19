import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {capturePostRaceAssessment,readPostRaceAssessments,postRaceAssessmentPage} from '../src/post-race-assessment.js';
async function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];const db={prepare(q){queries.push(q);const w=(args=[])=>({bind(...a){return w(a)},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:r.changes}}},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}}});return w()}};await ensureHistoryTable(db);
 sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);INSERT INTO jra_races VALUES('2026-10-18:京都:11','2026-10-18','京都',11,'秋華賞','芝',2000,2);INSERT INTO jra_runners VALUES('2026-10-18:京都:11',1,'HorseA',3),('2026-10-18:京都:11',2,'HorseB',3)");
 for(const name of ['HorseA','HorseB'])for(const date of ['2026-09-01','2026-09-15','2026-10-18'])sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name,date,'京都','試験','芝',2000,2,12,'良','https://www.jra.go.jp/profile','2026-10-19T00:00:00Z');queries.length=0;return{sql,db,queries}}
const target={date:'2026-10-18',venue:'京都',raceNo:11},now=Date.parse('2026-10-19T00:30:00Z');
test('post-race snapshot persists and reads back separately, without target outcomes or mark/lock/learning writes',async()=>{
 const {sql,db,queries}=await fixture();const a=await capturePostRaceAssessment(db,target,now);assert.equal(a.phase,'post-race-review');assert.equal(a.scoredRunners,2);assert.equal(a.guardrails.preRacePrediction,false);assert.equal(a.guardrails.eligibleForProspectiveAccuracy,false);assert.equal(a.guardrails.automaticTraining,false);
 assert.ok(a.histories.every(h=>h.recent.every(r=>r.date<target.date)));
 assert.equal(queries.some(q=>/lab_user_mark|lab_model_locks|lab_learning/i.test(q)),false);assert.ok(queries.filter(q=>/lab_race_outcomes|lab_race_result_details/.test(q)).every(q=>/r\.race_date<\?/.test(q)));assert.ok(queries.filter(q=>/^(INSERT|UPDATE|DELETE)/.test(q)).every(q=>q.includes('lab_post_race_assessments_v1')));
 const b=await capturePostRaceAssessment(db,target,now+60000);assert.equal(b.idempotent,true);assert.equal(a.snapshotSha256,b.snapshotSha256);assert.equal(a.createdAt,b.createdAt);const records=await readPostRaceAssessments(db,target);assert.equal(records.length,1);assert.equal(records[0].snapshotSha256,a.snapshotSha256);assert.match(postRaceAssessmentPage(records),/事後LABO参考印/);assert.throws(()=>sql.exec('DELETE FROM lab_post_race_assessments_v1'),/immutable/);sql.close();
});
test('current or future dates are refused before any database query',async()=>{
 const db={prepare(){assert.fail('date guard must precede DB')}};await assert.rejects(capturePostRaceAssessment(db,{...target,date:'2026-10-19'},now),/前日以前/);await assert.rejects(capturePostRaceAssessment(db,{...target,date:'2026-10-24'},now),/前日以前/);
});

test('failed readback is reported as uncertain, never a successful or safely repeatable write',async()=>{
 const {sql,db}=await fixture();const wrapped={prepare(q){if(q.startsWith('SELECT snapshot_json,created_at'))return{bind(){return{async first(){return null}}}};return db.prepare(q)}};
 await assert.rejects(capturePostRaceAssessment(wrapped,target,now),e=>e.saveMayHaveSucceeded===true&&/DB保存/.test(e.message));assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_post_race_assessments_v1').get().n,1);sql.close();
});
test('18-horse review stays below 20 DB calls and retains shared assessment scores',async()=>{
 const {sql,db,queries}=await fixture();sql.exec("UPDATE jra_races SET runner_count=18");for(let n=3;n<=18;n++){sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run('2026-10-18:京都:11',n,'Horse'+n,3);sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)').run('Horse'+n,'2026-09-01','京都','試験','芝',2000,3,12,'2026-10-19T00:00:00Z');}
 queries.length=0;const saved=await capturePostRaceAssessment(db,target,now);assert.equal(saved.race.runnerCount,18);assert.ok(queries.length<20,'18 horses should not trigger per-horse DB queries: '+queries.length);
 const {assessmentContext,officialHistoryEvidence}=await import('../src/race-history-assessment-v3.31.0.js');const old=await officialHistoryEvidence(db,await assessmentContext(db,target));assert.deepEqual(saved.runners.map(r=>[r.horseName,r.rank,r.score]),old.all.map(r=>[r.horseName,r.referenceRank,r.assessment.evidenceScore]));sql.close();
});
