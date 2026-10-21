import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {FUJI_EXPECTED_SOURCE} from '../src/expected-runner-preview-v3.30.0.js';
import {FUJI_HISTORY_SOURCE_URL} from '../src/fuji-history-secondary-v3.49.29.js';
import {captureSourceTrackRace,sourceTrackStatus,scheduledSourceTrack,fitSourceCandidateFromExamples,SOURCE_TRACK} from '../src/learning-source-track-v3.49.36.js';
import worker,{VERSION} from '../src/index-v3.49.0.js';
import {learningSourceTrackPage} from '../src/learning-source-track-page-v3.49.36.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE lab_expected_history_snapshots(snapshot_id TEXT,horse_name TEXT,race_date TEXT,venue TEXT,payload_json TEXT,source_url TEXT,ingested_at TEXT,PRIMARY KEY(snapshot_id,horse_name,race_date,venue));');
 const key='2026-10-17:東京:11';sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?,?)').run(key,FUJI_EXPECTED_SOURCE.date,FUJI_EXPECTED_SOURCE.venue,FUJI_EXPECTED_SOURCE.raceNo,'富士ステークス','芝',1600,FUJI_EXPECTED_SOURCE.names.length);
 for(let i=0;i<FUJI_EXPECTED_SOURCE.names.length;i++){
  const name=FUJI_EXPECTED_SOURCE.names[i],age=FUJI_EXPECTED_SOURCE.ages[name];sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(key,i+1,name,age);
  const row={horse_name:name,race_date:'2026-10-10',venue:'東京',race_name:'前走',surface:'芝',distance:1600,finish_position:1,field_size:12,time_text:'1:34.0',last3f:34,corner_positions:'3-3-3',track_condition:'良',source_url:FUJI_HISTORY_SOURCE_URL};
  sql.prepare('INSERT INTO lab_expected_history_snapshots VALUES(?,?,?,?,?,?,?)').run(FUJI_EXPECTED_SOURCE.snapshotId,name,row.race_date,row.venue,JSON.stringify(row),FUJI_HISTORY_SOURCE_URL,'2026-10-15T00:00:00.000Z');
 }
 const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(q).all(...args)}},async first(){return sql.prepare(q).get(...args)||null},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()}};
 return{sql,db};
}
const beforeRace=Date.parse('2026-10-16T03:00:00Z');

test('secondary source track stores its own immutable pre-race vector and preserves provenance',async()=>{
 const {sql,db}=fixture();const result=await captureSourceTrackRace(db,{date:'2026-10-17',venue:'東京',raceNo:11},beforeRace);
 assert.equal(result.status,'features-saved');assert.equal(result.runnerCount,14);assert.equal(result.provider,'netkeiba');
 const row=sql.prepare('SELECT * FROM lab_learning_source_features').get();assert.equal(row.track_id,SOURCE_TRACK.id);assert.equal(row.provider,'netkeiba');
 const body=JSON.parse(row.features_json);assert.equal(body.guardrails.jraValuesMixed,false);assert.equal(body.guardrails.targetResultRead,false);assert.equal(body.runners.length,14);assert.ok(body.runners.every(r=>r.historicalDates.every(d=>d<'2026-10-17')));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_history_snapshots').get().n,14);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,1);
 await assert.rejects(async()=>sql.prepare("UPDATE lab_learning_source_features SET features_json='{}'").run(),/immutable/);
 sql.exec('CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,finish_status TEXT,source_url TEXT,source_sha256 TEXT)');
 for(let i=0;i<FUJI_EXPECTED_SOURCE.names.length;i++){const name=FUJI_EXPECTED_SOURCE.names[i];sql.prepare('INSERT INTO lab_race_result_details VALUES(?,?,?,?,?,?,?)').run('2026-10-17:東京:11',i+1,name,i+1,'finished','https://www.jra.go.jp/JRADB/accessS.html?result='+i,'official-sha-'+i)}
 const labels=await scheduledSourceTrack(db,Date.parse('2026-10-18T03:00:00Z'));assert.equal(labels.status,'labels-saved');assert.equal(labels.labelCount,14);
 const status=await sourceTrackStatus(db);assert.equal(status.counts[0].feature_races,1);assert.equal(status.counts[0].labelled_races,1);assert.equal(status.featuresModifyCurrentPrediction,false);sql.close();
});

test('secondary source track refuses reconstruction after the race date',async()=>{
 const {sql,db}=fixture();await assert.rejects(()=>captureSourceTrackRace(db,{date:'2026-10-17',venue:'東京',raceNo:11},Date.parse('2026-10-18T01:00:00Z')),/開催後/);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_learning_source_features').get().n,0);sql.close();
});

test('partial secondary coverage is recorded but cannot be treated as a full-field training example',async()=>{
 const {sql,db}=fixture();sql.prepare('DELETE FROM lab_expected_history_snapshots WHERE horse_name=?').run('エンペラーズソード');
 const result=await captureSourceTrackRace(db,{date:'2026-10-17',venue:'東京',raceNo:11},beforeRace);
 assert.equal(result.status,'partial-feature-saved');assert.equal(result.featureSaved,true);assert.equal(result.eligibleForTraining,false);assert.deepEqual(result.missingHistoryHorses,['エンペラーズソード']);
 const saved=JSON.parse(sql.prepare('SELECT features_json FROM lab_learning_source_features').get().features_json);assert.equal(saved.completeRunnerPool,false);assert.equal(saved.runners.length,14);assert.equal(saved.runners.find(r=>r.horseName==='エンペラーズソード').scoreAvailable,false);sql.close();
});

test('production API exposes readback and requires explicit capture intent',async()=>{
 const {sql,db}=fixture();const get=await worker.fetch(new Request('https://api.test/v1/lab/learning-source-track'),{DB:db},{});assert.equal(get.status,200);const status=await get.json();assert.equal(status.version,VERSION);assert.equal(status.track.id,SOURCE_TRACK.id);assert.equal(status.featuresModifyCurrentPrediction,false);
 const before=sql.prepare("SELECT COUNT(*) n FROM lab_learning_source_features").get().n;
 const post=await worker.fetch(new Request('https://api.test/v1/lab/learning-source-track-capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-10-17',venue:'東京',raceNo:11})}),{DB:db},{});assert.equal(post.status,400);assert.equal((await post.json()).error,'confirm CAPTURE が必要です。');assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_learning_source_features").get().n,before);assert.equal(VERSION,'3.49.52');sql.close();
});

test('repeated source-track status reads are served from edge cache without another D1 query',async()=>{
 const {sql,db}=fixture(),rows=new Map(),old=globalThis.caches;let queryCount=0;
 globalThis.caches={default:{async match(key){return rows.get(key.url)?.clone()||null},async put(key,response){rows.set(key.url,response.clone())},async delete(key){return rows.delete(key.url)}}};
 const prepare=db.prepare.bind(db);db.prepare=sqlText=>{queryCount++;return prepare(sqlText)};
 try{
  const req=()=>new Request('https://api.test/v1/lab/learning-source-track');
  const first=await worker.fetch(req(),{DB:db},{});assert.equal(first.status,200);await first.text();const afterFirst=queryCount;assert.ok(afterFirst>0);
  const second=await worker.fetch(req(),{DB:db},{});assert.equal(second.status,200);await second.text();assert.equal(queryCount,afterFirst);
 }finally{if(old===undefined)delete globalThis.caches;else globalThis.caches=old;sql.close()}
});

test('source lane page compiles and accurately describes its isolated score scope',async()=>{
 const html=learningSourceTrackPage();for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script);assert.ok(html.includes('現行スコア、予想順位、ユーザー印、LOCKは変更しません'));assert.ok(html.includes('勝率や期待値の確率モデルではありません'));
 const page=await worker.fetch(new Request('https://api.test/lab/learning-source-track'),{},{});assert.equal(page.status,200);assert.match(await page.text(),/二次ソース学習レーン/);
});

test('secondary shadow fit needs thirty dated complete races and never consumes validation examples',()=>{
 const examples=Array.from({length:30},(_,i)=>({raceKey:'source-'+i,date:i<15?'2026-10-20':'2026-10-21',phase:'training',completeRunnerPool:true,runners:[{finish:1,components:{basicAbilityResults:80,recentPerformanceDevelopment:70,courseDistanceFit:60,ground:50}},{finish:2,components:{basicAbilityResults:30,recentPerformanceDevelopment:50,courseDistanceFit:50,ground:50}}]}));
 const fit=fitSourceCandidateFromExamples(examples);assert.equal(fit.status,'candidate-fitted');assert.equal(fit.trainingRaces,30);assert.equal(fit.validationUsedForSelection,false);assert.equal(fit.automaticPromotion,false);
 assert.equal(fitSourceCandidateFromExamples(examples.slice(0,29)).status,'awaiting-training-data');assert.throws(()=>fitSourceCandidateFromExamples([...examples,{...examples[0],phase:'validation',date:'2027-01-02'}]),/検証用/);
});
