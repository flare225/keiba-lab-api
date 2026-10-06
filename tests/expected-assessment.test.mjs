import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {assessExpectedHistory,expectedAssessment,rankAssessment} from '../src/expected-assessment-v3.31.0.js';
import {EXPECTED_SOURCES} from '../src/expected-runner-preview-v3.30.0.js';
import {ingestExpectedHistory} from '../src/expected-history-snapshot-v3.30.0.js';
import {expectedPreviewPage} from '../src/expected-preview-page-v3.31.0.js';
const race=EXPECTED_SOURCES[0];
const run={date:'2026-06-06',venue:'東京',surface:'芝',distance:1600,finish:1,fieldSize:9,last3f:33.3,trackCondition:'良'};
test('history feeds existing model and missing evidence stays unknown',()=>{
 const a=assessExpectedHistory({available:true,recent:[run]},race);
 assert.equal(a.evidenceScore,100);assert.equal(a.modelCoveragePct,60);assert.equal(a.evidenceStrength,'thin');assert.equal(a.components.ground,null);assert.equal(a.sameCourseDistanceStarts,1);
 assert.equal(assessExpectedHistory({available:false,recent:[]},race).evidenceScore,null);
 const b=assessExpectedHistory({available:true,recent:[{...run,fieldSize:null}]},race);assert.equal(b.evidenceDepthPct,0);assert.equal(b.evidenceScore,null);
});
test('track is explicit, matching and unconfirmed; last3f does not reorder horses',()=>{
 const a=assessExpectedHistory({available:true,recent:[{...run,trackCondition:'稍'}]},race,'稍重');assert.equal(a.components.ground,100);assert.equal(a.modelCoveragePct,70);
 const b=assessExpectedHistory({available:true,recent:[{...run,last3f:50}]},race);const c=assessExpectedHistory({available:true,recent:[{...run,last3f:29}]},race);assert.equal(b.evidenceScore,c.evidenceScore);
 assert.throws(()=>assessExpectedHistory({available:true,recent:[run]},race,'不明'));
});
test('target-day records cannot affect model and tied scores share ranks',()=>{
 const a=assessExpectedHistory({available:true,recent:[run,{...run,date:race.date,finish:9}]},race);assert.equal(a.historyRows,1);
 const rows=rankAssessment([{horseName:'B',assessment:a},{horseName:'A',assessment:a},{horseName:'missing',assessment:{available:false}}]);assert.equal(rows[0].referenceRank,1);assert.equal(rows[1].referenceRank,1);assert.equal(rows[0].tiedCount,2);assert.equal(rows[2].referenceRank,null);
});
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,finish_position INTEGER,field_size INTEGER,time_text TEXT,last3f REAL,corner_positions TEXT,track_condition TEXT,source_url TEXT)');
 const db={prepare(query){return{bind(...args){return{async all(){return{results:sql.prepare(query).all(...args)}},async first(){return sql.prepare(query).get(...args)||null},async run(){return sql.prepare(query).run(...args)}}},async run(){return sql.prepare(query).run()}}},async batch(statements){for(const s of statements)await s.run()}};
 return {sql,db};
}
test('real SQLite snapshot roundtrip uses full pool and marks never change the scores',async()=>{
 const {sql,db}=database();await ingestExpectedHistory(db,race);
 const base={date:race.date,venue:race.venue,raceNo:race.raceNo};
 const a=await expectedAssessment(db,{...base,marks:[{horseName:'デミアン',mark:'◎'}]});
 const b=await expectedAssessment(db,{...base,marks:[{horseName:'デミアン',mark:'消'},{horseName:'フィリオソラーレ',mark:'○'}]});
 assert.equal(a.assessment.runnerPool,12);assert.equal(a.assessment.scoredRunners,12);assert.deepEqual(a.assessment.allRunners,b.assessment.allRunners);assert.equal(a.audit.marked[0].mark,'◎');assert.equal(b.audit.marked[0].mark,'消');assert.equal(a.audit.marked[0].laboRank,null);
 assert.equal(a.assessment.marked[0].assessment.evidenceStrength,'thin');assert.equal(a.assessment.guardrails.accuracyImprovementValidated,false);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_history_snapshots').get().n,18);sql.close();
});
test('new page exposes scenario and provisional assessment, inline script compiles',()=>{
 const html=expectedPreviewPage();assert.ok(html.includes('馬場の想定'));assert.ok(html.includes('/v1/lab/race-history-assessment'));assert.ok(html.includes('的中確率ではありません'));for(const [,s] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(s);
});

import {raceHistoryAssessment,targetInput} from '../src/race-history-assessment-v3.31.0.js';
test('any stored race uses its own course, full card, and historical age correctly',async()=>{
 const {sql,db}=database();
 sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT);");
 sql.exec("INSERT INTO jra_races VALUES('target','2026-10-11','京都',9,'任意レース','ダート',1800,2),('prior','2025-09-11','京都',9,'過去レース','ダート',1800,12);INSERT INTO jra_runners VALUES('target',1,'馬A',4),('target',2,'馬B',4),('prior',3,'馬A',3);INSERT INTO lab_race_outcomes VALUES('prior',3,2);INSERT INTO lab_race_result_details VALUES('prior',3,2,'finished','1:53.2',113.2,'3-3-3-2',37.2,'https://jra.go.jp/');");
 const result=await raceHistoryAssessment(db,{date:'2026-10-11',venue:'京都',raceNo:9,marks:[{horseName:'馬A',mark:'◎'}]});
 assert.equal(result.assessment.runnerPool,2);assert.equal(result.assessment.scoredRunners,1);assert.equal(result.audit.historySidecar[0].recent[0].date,'2025-09-11');assert.equal(result.assessment.marked[0].assessment.sameCourseDistanceStarts,1);assert.equal(result.audit.marked[0].horseNo,1);
 assert.equal(result.assessment.allRunners[1].referenceRank,null);assert.equal(result.assessment.allRunners[1].assessment.evidenceScore,null);
 const {assessmentContext}=await import('../src/race-history-assessment-v3.31.0.js');const context=await assessmentContext(db,{date:'2026-10-11',venue:'京都',raceNo:9});const html=expectedPreviewPage(context);assert.ok(!html.includes('10月5日掲載'));assert.ok(!html.includes('掲載記事を確認'));assert.ok(html.includes('保存済みJRA出馬表'));assert.ok(html.includes('1番 馬A'));
 await assert.rejects(()=>raceHistoryAssessment(db,{date:'2026-10-11',venue:'京都',raceNo:1,marks:[{horseName:'馬A',mark:'◎'}]}),/出馬表/);sql.close();
 assert.throws(()=>targetInput({date:'2026-02-30',venue:'東京',raceNo:1}));
});
