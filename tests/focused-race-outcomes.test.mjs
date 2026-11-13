import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFocusedOutcomes} from '../src/focused-race-outcomes.js';
import {runFocusedScheduled,focusScheduleState} from '../src/focused-race-completion.js';
import {savePublishedResultSources,ensureResultSources,discoverResultSource} from '../src/official-result-sources-v3.39.0.js';
import {runSharedPageStep} from '../src/shared-page-acquisition.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {scheduledAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {sealSavedAutomaticPrediction} from '../src/saved-automatic-seal.js';
import {readAutomaticLearningCandidate} from '../src/automatic-learning-candidates.js';
import {ensureResultDetailTables} from '../src/result-detail-v3.39.0.js';
import {ensureEvidenceTable} from '../src/card-evidence.js';
import {fixtureDatabase,racesFixture,pageGraph,fixtureFetcher,cardUrl,calendar,drawnHtml} from './helpers/shared-page-fixture.mjs';
const target={date:'2026-11-15',venue:'京都',raceNo:11,expiresAt:'2026-11-15T06:35:00Z'},stamp=Date.parse('2026-11-15T07:15:00Z');
const verified={locked:true,integrityVerified:true,preRaceVerified:true,snapshotSha256:'a'.repeat(64)};
test('outcome lane cannot run before official start+35m or without verified original LOCK; quota stops immediately',async()=>{
 let requests=0;
 const f=await fixtureDatabase();f.sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);INSERT INTO jra_race_program VALUES('2026-11-15','京都',11,'15:40','https://www.jra.go.jp/program')");
 const deps={now:()=>stamp-1,lock:()=>assert.fail('early LOCK read'),results:()=>{requests++;assert.fail('early source')}};
 assert.equal((await collectFocusedOutcomes(f.db,target,deps)).status,'focus-awaiting-result-window');
 assert.equal((await collectFocusedOutcomes(f.db,target,{...deps,now:()=>stamp,lock:async()=>({locked:false})})).status,'focus-awaiting-verified-lock');
 const error=Object.assign(Error('budget exhausted'),{d1DailyReadLimit:true});
 await assert.rejects(collectFocusedOutcomes({},target,{window:async()=>{throw error},lock:()=>assert.fail('after quota')}),e=>e===error);
 assert.equal(requests,0);f.sql.close();
});
test('expiry changes only the same target result lane, retains rotation, never predicts/reseals/collects history',async()=>{
 const f=await fixtureDatabase();let tick=stamp,calls=0;
 assert.equal(focusScheduleState(target,{cron:'0 * * * *'},tick),'focus-background-deferred');
 for(let i=0;i<6;i++){
  await runFocusedScheduled({cron:'*/3 * * * *',scheduledTime:tick},{DB:f.db},target,{now:()=>tick,predict:()=>assert.fail('post cutoff prediction'),seal:()=>assert.fail('post cutoff seal'),collect:()=>assert.fail('post cutoff history'),outcomes:async(_,t)=>{assert.deepEqual(t,target);calls++;return{status:'cooldown',externalRequests:0}}});tick+=360000;
 }
 assert.equal(calls,2);
 assert.equal(focusScheduleState(target,{cron:'*/3 * * * *'},Date.parse(target.expiresAt)+86400000),'focus-expired-or-outside-window');f.sql.close();
});
test('target discovery respects durable receipt and a source discovery consumes only its one existing request slot',async()=>{
 const f=await fixtureDatabase();await ensureResultSources(f.db);await ensureEvidenceTable(f.db);
 f.sql.exec("INSERT INTO jra_races(race_key,race_date,venue,race_no,fetched_at) VALUES('other','2026-11-14','東京',11,'old'),('target','2026-11-15','京都',11,'old');INSERT INTO lab_card_source_evidence(race_key,source_url,source_sha256,runner_sha256,declared_count,source_row_count,parsed_count,horse_numbers_observed,frames_observed,card_fetched_at,verified_at,count_basis) VALUES('other','other-url','sha','sha',1,1,1,1,1,'old','old','test'),('target','target-url','sha','sha',1,1,1,1,1,'old','old','test')");
 const base={now:()=>stamp,window:async()=>true,lock:async()=>verified,readCandidate:async()=>({available:false}),results:async()=>({status:'source-unresolved',externalRequests:0}),candidates:()=>assert.fail('no labels before results')};
 f.sql.prepare('INSERT INTO lab_result_source_receipts VALUES(?,?,?,?,?)').run('target',stamp,stamp+3600000,'source-not-found',null);
 assert.equal((await collectFocusedOutcomes(f.db,target,{...base,discover:()=>assert.fail('receipt bypass')})).status,'focus-result-source-not-due');
 f.sql.exec('DELETE FROM lab_result_source_receipts');let calls=0;
 const out=await collectFocusedOutcomes(f.db,target,{...base,discover:async(_,d)=>{calls++;assert.deepEqual(d.target,target);assert.equal(d.sourceTarget.race_key,'target');return{status:'source-discovered',externalRequests:1}}});
 assert.equal(out.externalRequests,1);assert.equal(calls,1);
 await assert.rejects(discoverResultSource(f.db,{target,sourceTarget:{race_date:'2026-11-14',venue:'東京',race_no:11},fetcher:()=>assert.fail('wrong target HTTP')}),/target mismatch/);f.sql.close();
});
test('a multi-race published result page registers only the focused result link',async()=>{
 const f=await fixtureDatabase();await ensureResultSources(f.db);
 const urls=[11,12].map(n=>`https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde010820260504${n}20261115/AA`);
 assert.equal(await savePublishedResultSources(f.db,urls.map(u=>`<a href="${u}">result</a>`).join(''),cardUrl({...target}),target.date,new Date(stamp).toISOString(),target),1);
 assert.deepEqual(f.sql.prepare('SELECT race_key FROM lab_official_result_sources').all().map(r=>r.race_key),['2026-11-15:京都:11']);f.sql.close();
});
test('partial, failed and paused target results cannot label; candidate pairing fails closed',async()=>{
 const base={now:()=>stamp,window:async()=>true,lock:async()=>verified,readCandidate:async()=>({available:false})};
 for(const status of ['partial','failed','receipt-cooldown','cooldown']){
  const out=await collectFocusedOutcomes({},target,{...base,results:async()=>({status,externalRequests:status==='failed'?1:0}),candidates:()=>assert.fail('incomplete results cannot label')});assert.equal(out.status,status);
 }
 await assert.rejects(collectFocusedOutcomes({},target,{...base,readCandidate:async()=>({available:true,record:{predictionSha256:'wrong'}}),results:()=>assert.fail('mismatched original')}),/original LOCK/);
});
test('real saved forecast/LOCK -> full target result -> immutable paired candidate; adjacent race and second call cause no source work',async()=>{
 const f=await fixtureDatabase(),date='2026-11-15',before=Date.parse('2026-11-13T00:00:00Z');
 const r={...racesFixture()[0],date,venue:'京都',raceNo:11,startAt:date+'T15:40:00+09:00',rootUrl:calendar(date),enqueuedAt:new Date(before).toISOString()};r.cardUrl=cardUrl(r);
 assert.equal((await runSharedPageStep(f.db,{scope:date,races:[r]},{now:()=>before,fetcher:fixtureFetcher(pageGraph([r]))})).formalCardSaved,true);
 await ensureHistoryTable(f.db);await ensureResultDetailTables(f.db);
 f.sql.exec("CREATE TABLE jra_race_program(program_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,source_kind TEXT,source_url TEXT,fetched_at TEXT,UNIQUE(race_key,horse_no))");
 f.sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?,?)').run(`${date}:京都:11`,date,'京都',11,'15:40',r.rootUrl);
 for(const name of ['テストア','テストイ'])for(const d of ['2026-09-01','2026-09-15','2026-10-01'])f.sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(name,d,'京都','合成履歴','芝',1600,2,12,'https://www.jra.go.jp/profile',new Date(before).toISOString());
 const prediction=await scheduledAutomaticPrediction(f.db,before+61000,{...target});assert.equal(prediction.saved,1);
 await sealSavedAutomaticPrediction(f.db,target,{now:()=>before+120000});
 const locks=f.sql.prepare('SELECT * FROM lab_model_locks').all(),seals=f.sql.prepare('SELECT * FROM lab_prospective_seals').all();
 // A different older forecast is eligible globally, but may not be labelled.
 f.sql.exec("INSERT INTO lab_automatic_predictions_v1 SELECT 'other','2026-11-14',snapshot_json,snapshot_sha256,saved_at FROM lab_automatic_predictions_v1 LIMIT 1");
 await ensureResultSources(f.db);const url='https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0108202605041120261115/AA';
 const header=['着順','枠','馬番','馬名','性齢','斤量','騎手','タイム','着差','コーナー 通過順位','推定上り','人気','単勝','馬体重'];
 const html='<table><tr>'+header.map(v=>`<th>${v}</th>`).join('')+'</tr>'+['テストア','テストイ'].map((name,i)=>'<tr>'+[i+1,i+1,i+1,name,'牡3','57','騎手','1:33.2','','4 3','33.3',i+1,'5.0','480(+2)'].map(v=>`<td>${v}</td>`).join('')+'</tr>').join('')+'</table>';
 let requests=0,tick=stamp;const deps={now:()=>tick,fetcher:async(requestUrl)=>{requests++;return new Response(requestUrl.endsWith('accessD.html')?drawnHtml(r)+`<a href="${url}">result</a>`:html,{headers:{'content-type':'text/html; charset=utf-8'}})}};
 const discovery=await collectFocusedOutcomes(f.db,target,deps);assert.equal(discovery.status,'source-discovered');assert.equal(requests,1);
 assert.equal((await collectFocusedOutcomes(f.db,target,deps)).status,'cooldown');assert.equal(requests,1);
 tick+=61000;const result=await collectFocusedOutcomes(f.db,target,deps);assert.equal(result.status,'focus-outcomes-complete');assert.equal(requests,2);assert.equal(result.candidate.saved,1);
 const candidate=await readAutomaticLearningCandidate(f.db,target);assert.equal(candidate.record.predictionSha256,prediction.snapshotSha256);assert.equal(candidate.record.rows.length,2);assert.equal(candidate.record.guardrails.automaticTraining,false);assert.equal(candidate.record.guardrails.automaticPromotion,false);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM lab_automatic_learning_candidates_v1').get().n,1);
 assert.deepEqual(f.sql.prepare('SELECT * FROM lab_model_locks').all(),locks);assert.deepEqual(f.sql.prepare('SELECT * FROM lab_prospective_seals').all(),seals);
 assert.equal((await collectFocusedOutcomes(f.db,target,deps)).status,'focus-outcomes-complete');assert.equal(requests,2);f.sql.close();
});
