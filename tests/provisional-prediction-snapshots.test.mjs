import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {saveProvisionalPrediction,readProvisionalPrediction} from '../src/provisional-prediction-snapshots.js';
const t={date:'2026-10-25',venue:'新潟',raceNo:11},now=Date.parse('2026-10-21T00:00:00Z');
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const wrap=(a=[])=>({bind(...v){return wrap(v)},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){return sql.prepare(q).get(...a)||null}});return wrap()}};return{sql,db};}
function sample(){return{ok:true,status:'provisional-expected-roster',race:t,runnerCount:1,runners:[{horseName:'保存馬',horseNo:null,frameNo:null,rank:1,score:90,mark:'◎'}],guardrails:{humanMarksUsed:false,officialCard:false,locked:false,eligibleForLearning:false,persisted:false}};}
test('real SQLite saves once, preserves exact contents on retries and rejects mutation',async()=>{const {sql,db}=fixture();const a=await saveProvisionalPrediction(db,t,async()=>sample(),now);assert.equal(a.saved,1);assert.equal(a.snapshot.guardrails.persisted,true);const b=await saveProvisionalPrediction(db,t,async()=>{throw Error('must not regenerate')},now+1000);assert.equal(b.saved,0);assert.equal(b.snapshotSha256,a.snapshotSha256);const {saved,...expected}=a;assert.deepEqual(await readProvisionalPrediction(db,t),expected);assert.throws(()=>sql.exec('DELETE FROM lab_provisional_predictions_v1'),/immutable/);sql.close();});
test('old targets cannot save; wrong-target generations cannot enter DB',async()=>{const {sql,db}=fixture();await assert.rejects(saveProvisionalPrediction(db,t,async()=>sample(),now+5*86400000));await assert.rejects(saveProvisionalPrediction(db,t,async()=>({...sample(),race:{...t,raceNo:10}}),now));assert.equal((await readProvisionalPrediction(db,t)).available,false);sql.close();});
test('insert success and read failure retains row; retry only reads saved snapshot',async()=>{const {sql,db}=fixture();let read=0;const broken={prepare(q){if(q.startsWith('SELECT * FROM lab_provisional_predictions_v1')&&++read>1)return{bind(){return{async first(){throw Error('read failed')}}}};return db.prepare(q)}};await assert.rejects(saveProvisionalPrediction(broken,t,async()=>sample(),now),e=>e.saveMayHaveSucceeded===true);assert.equal(sql.prepare('SELECT count(*) n FROM lab_provisional_predictions_v1').get().n,1);assert.equal((await saveProvisionalPrediction(db,t,async()=>{throw Error('regenerated')},now+1000)).saved,0);sql.close();});

test('stored prior rows flow through the real batch scorer, persistence and independent GET reader',async()=>{
 const {sql,db}=fixture();const {ensureHistoryTable}=await import('../src/collection-profile-parser-v3.32.0.js');const {provisionalExpectedPrediction,repairStoredProgramConditions}=await import('../src/provisional-expected-prediction.js');await ensureHistoryTable(db);
 sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,surface TEXT,distance INTEGER,source_url TEXT,race_label TEXT);INSERT INTO jra_race_program VALUES('2026-10-25','新潟',11,'芝',1000,'https://www.jra.go.jp/program',NULL)");
 sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('保存馬','2026-09-01','新潟','試験','芝',1000,2,12,'https://www.jra.go.jp/history','2026-10-20T00:00:00Z');
 let programReads=0;const allDb={prepare(q){if(q.includes('FROM jra_race_program WHERE'))programReads++;const wrap=(a=[])=>({bind(...v){return wrap(v)},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}}});return wrap()}};
 const source={...t,names:['保存馬'],age:3,snapshotId:'registered:local-fixture'},program=await repairStoredProgramConditions(allDb,source);assert.equal(program.repaired,0);assert.equal(program.conditions.surface,'芝');const saved=await saveProvisionalPrediction(allDb,t,()=>provisionalExpectedPrediction(allDb,source,now,{loaded:true,conditions:program.conditions}),now);assert.equal(saved.saved,1);assert.equal(programReads,1);assert.equal(saved.snapshot.runners[0].mark,'◎');assert.equal(saved.snapshot.runners[0].assessment.provenance,'stored-db');assert.equal(saved.snapshot.guardrails.locked,false);assert.deepEqual((await readProvisionalPrediction(allDb,t)).snapshot,saved.snapshot);sql.close();
});

test('unconfirmed and confirmed predraw snapshots coexist by source SHA without replacing prior evaluation',async()=>{
 const {sql,db}=fixture(),{provisionalStorageKey}=await import('../src/provisional-prediction-snapshots.js');
 const old=await saveProvisionalPrediction(db,t,async()=>sample(),now),sha='a'.repeat(64),version={...t,basis:'confirmed-predraw',sourceSha256:sha};
 const make=()=>({...sample(),preparation:{stage:'entries-confirmed-predraw',sourceSha256:sha},runners:[{...sample().runners[0],score:80}]});
 const fresh=await saveProvisionalPrediction(db,version,async()=>make(),now+1000);assert.equal(fresh.saved,1);assert.equal(sql.prepare('SELECT count(*) n FROM lab_provisional_predictions_v1').get().n,2);
 assert.equal((await readProvisionalPrediction(db,t,{exact:true})).snapshotSha256,old.snapshotSha256);assert.equal((await readProvisionalPrediction(db,t)).snapshotSha256,fresh.snapshotSha256);assert.equal((await readProvisionalPrediction(db,version)).snapshotSha256,fresh.snapshotSha256);assert.notEqual(old.snapshotSha256,fresh.snapshotSha256);
 assert.equal((await readProvisionalPrediction(db,{...version,sourceSha256:'b'.repeat(64)})).available,false);
 assert.throws(()=>provisionalStorageKey({...version,sourceSha256:'bad'}));assert.throws(()=>sql.exec('UPDATE lab_provisional_predictions_v1 SET saved_at=\'changed\''),/immutable/);
 const {default:app}=await import('../src/index-v3.49.0.js');const url='https://test/v1/lab/provisional-prediction-snapshot?date='+t.date+'&venue='+encodeURIComponent(t.venue)+'&race_no='+t.raceNo+'&basis=confirmed-predraw&source_sha256='+sha;
 const result=await app.fetch(new Request(url),{DB:db},{}),body=await result.json();assert.equal(result.status,200);assert.equal(body.snapshotSha256,fresh.snapshotSha256);assert.equal(body.snapshot.guardrails.locked,false);sql.close();
});

test('SHA-selected GET reads a witnessed expected revision despite predraw preference and stays race scoped',async()=>{
 const {sql,db}=fixture(),{provisionalEvaluationFingerprint}=await import('../src/provisional-prediction-snapshots.js');
 const initial=await saveProvisionalPrediction(db,t,async()=>sample(),now),sourceSha='a'.repeat(64);
 const predraw=await saveProvisionalPrediction(db,{...t,basis:'confirmed-predraw',sourceSha256:sourceSha},async()=>({...sample(),preparation:{stage:'entries-confirmed-predraw',sourceSha256:sourceSha}}),now+1000);
 const changed={...sample(),runners:[{...sample().runners[0],score:95}]},revisionSha256=await provisionalEvaluationFingerprint(changed);
 const revised=await saveProvisionalPrediction(db,{...t,revisionSha256},async()=>changed,now+2000);
 assert.equal((await readProvisionalPrediction(db,t)).snapshotSha256,predraw.snapshotSha256);
 const {default:app}=await import('../src/index-v3.49.0.js');
 const url='https://test/v1/lab/provisional-prediction-snapshot?date='+t.date+'&venue='+encodeURIComponent(t.venue)+'&race_no='+t.raceNo;
 let writes=0;const readOnly={prepare(q){assert.match(q,/^SELECT/);writes++;return db.prepare(q)}};
 const response=await app.fetch(new Request(url+'&snapshot_sha256='+revised.snapshotSha256),{DB:readOnly},{}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.integrityVerified,true);assert.equal(body.snapshotSha256,revised.snapshotSha256);assert.equal(body.snapshot.runners[0].score,95);
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(JSON.stringify(body.snapshot)).digest('hex'),revised.snapshotSha256);assert.equal(writes,1);
 for(const [params,available] of [['&race_no=10&snapshot_sha256='+revised.snapshotSha256,false],['&snapshot_sha256='+'f'.repeat(64),false],['&basis=confirmed-predraw&source_sha256='+sourceSha+'&snapshot_sha256='+revised.snapshotSha256,false]]){
  const selectedUrl=params.startsWith('&race_no=10')?url.replace('race_no='+t.raceNo,'race_no=10')+params.replace('&race_no=10',''):url+params;
  const r=await app.fetch(new Request(selectedUrl),{DB:db},{});assert.equal(r.status,200);assert.equal((await r.json()).available,available);
 }
 const invalid=await app.fetch(new Request(url+'&snapshot_sha256=bad'),{DB:readOnly},{});assert.equal(invalid.status,409);assert.match((await invalid.json()).error,/保存SHA/);
 assert.equal((await readProvisionalPrediction(db,t,{exact:true})).snapshotSha256,initial.snapshotSha256);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_provisional_predictions_v1').get().n,3);
 const original=sql.prepare('SELECT * FROM lab_provisional_predictions_v1 WHERE snapshot_sha256=?').get(revised.snapshotSha256);
 const corrupted={prepare(){return{bind(){return{async first(){return{...original,snapshot_json:original.snapshot_json+' '}}}}}}};
 await assert.rejects(readProvisionalPrediction(corrupted,t,{snapshotSha256:revised.snapshotSha256}),/保存ハッシュ/);
 sql.close();
});
