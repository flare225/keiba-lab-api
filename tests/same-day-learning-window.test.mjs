import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assertBeforeOfficialStart,EXPERIMENT,captureExperimentRace,freezeExperiment,hash,validationCapturedBeforeRace} from '../src/learning-experiment-v3.40.0.js';

function programDb(startTime='15:45',sourceUrl='https://www.jra.go.jp/JRADB/accessD.html'){
 const db={prepare(sql){return{bind(){return{async first(){return sql.includes('jra_race_program')?{start_time:startTime,source_url:sourceUrl}:null}}}}}};
 return db;
}

test('same-day validation window opens only before official JRA post time with a safety buffer',async()=>{
 const context={date:'2026-10-17',venue:'東京',raceNo:11};
 const allowed=await assertBeforeOfficialStart(programDb(),context,Date.parse('2026-10-17T00:00:00Z')); // 09:00 JST
 assert.equal(allowed.ok,true);assert.equal(allowed.startTime,'15:45');assert.equal(allowed.bufferMinutes,5);
 await assert.rejects(()=>assertBeforeOfficialStart(programDb(),context,Date.parse('2026-10-17T06:41:00Z')),/発走5分前/); // 15:41 JST
});

test('same-day validation fails closed if official program time or source is missing',async()=>{
 const context={date:'2026-10-17',venue:'東京',raceNo:11};
 await assert.rejects(()=>assertBeforeOfficialStart(programDb(null),context,Date.parse('2026-10-17T00:00:00Z')),/JRA公式開催番組/);
 await assert.rejects(()=>assertBeforeOfficialStart(programDb('15:45','https://example.com/card'),context,Date.parse('2026-10-17T00:00:00Z')),/JRA公式開催番組/);
});

test('same-day official race can save result-blind validation features before scheduled start',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,finish_position INTEGER,field_size INTEGER,time_text TEXT,last3f REAL,corner_positions TEXT,track_condition TEXT,source_url TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT,source_sha256 TEXT);CREATE TABLE jra_race_program(program_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);INSERT INTO jra_races VALUES('priorA','2026-09-01','東京',1,'前走A','芝',1600,12),('priorB','2026-09-01','東京',2,'前走B','芝',1600,12),('2026-10-17|東京|11','2026-10-17','東京',11,'富士S','芝',1600,2);INSERT INTO jra_runners VALUES('2026-10-17|東京|11',1,'馬A',4),('2026-10-17|東京|11',2,'馬B',4);INSERT INTO jra_past_performances VALUES('馬A','2026-09-01','東京','前走A','芝',1600,1,12,'1:32.0',33.1,'2-2','良','https://www.jra.go.jp/p'),('馬B','2026-09-01','東京','前走B','芝',1600,5,12,'1:33.0',34.0,'5-5','良','https://www.jra.go.jp/p');INSERT INTO jra_race_program VALUES('2026-10-17:東京:11','2026-10-17','東京',11,'15:45','https://www.jra.go.jp/program');");
 const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(q).all(...args)}},async first(){return sql.prepare(q).get(...args)||null},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()}};
 const now=Date.parse('2026-10-17T00:00:00Z');await freezeExperiment(db,Date.parse('2026-10-06T05:00:00Z'));
 const candidate=JSON.stringify({weights:{basicAbilityResults:30,recentPerformanceDevelopment:15,courseDistanceFit:15,ground:10}});
 await db.prepare('INSERT INTO lab_learning_candidates VALUES(?,?,?,?)').bind(EXPERIMENT.id,candidate,await hash(candidate),new Date(now).toISOString()).run();
 const result=await captureExperimentRace(db,{date:'2026-10-17',venue:'東京',raceNo:11},now);
 assert.equal(result.status,'awaiting-results');assert.equal(result.phase,'validation');assert.equal(result.runnerCount,2);
 const row=sql.prepare('SELECT * FROM lab_learning_features WHERE race_key=?').get('2026-10-17|東京|11');assert.ok(row);
 const features=JSON.parse(row.features_json);assert.equal(validationCapturedBeforeRace(row,features),true);assert.equal(validationCapturedBeforeRace({...row,captured_at:'2026-10-17T07:00:00Z'},features),false);assert.equal(features.guardrails.targetResultReadForFeatures,false);assert.equal(features.guardrails.humanMarksUsed,false);assert.ok(features.runners.every(r=>r.candidateScore!==null));
 sql.close();
});
