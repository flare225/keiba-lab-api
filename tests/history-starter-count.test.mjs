import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sha256} from '../src/card-evidence.js';
import {historyForExpected} from '../src/expected-runner-preview-v3.30.0.js';
import {postRaceHistoryBatch} from '../src/post-race-history-batch.js';
const key='2026-10-25:京都:3',resultUrl='https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0108202604090320261025/0D';
async function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE jra_runners(horse_name TEXT,race_key TEXT,horse_no INTEGER,age INTEGER);
 CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER,race_no INTEGER);
 CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);
 CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT);
 CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,finish_position INTEGER,field_size INTEGER,time_text TEXT,last3f REAL,corner_positions TEXT,track_condition TEXT,source_url TEXT);
 CREATE TABLE lab_prior_detail_evidence(detail_json TEXT,result_url TEXT,fetched_at TEXT);
 CREATE TABLE lab_card_withdrawals_v1(race_key TEXT,horse_no INTEGER,horse_name TEXT,status TEXT,proof_json TEXT,proof_sha256 TEXT,card_source_sha256 TEXT,recorded_at TEXT);`);
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?,?)').run(key,'2026-10-25','京都','2歳未勝利','芝',1600,9,3);
 let place=0;for(let no=1;no<=9;no++){
  sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(no===1?'コルサロ':no===5?'シュプレヒコール':'馬'+no,key,no,2);
  sql.prepare('INSERT INTO lab_race_result_details VALUES(?,?,?,?,?,?,?,?,?)').run(key,no,no===5?null:++place,no===5?'scratched':'finished',no===5?null:'1:33.7',no===5?null:93.7,null,no===5?null:35.4,resultUrl);
 }
 sql.prepare('INSERT INTO jra_past_performances VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('コルサロ','2026-10-25','京都','2歳未勝利','芝',1600,1,8,'1:33.7',35.4,null,null,'https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002024104709/0C');
 const proof={date:'2026-10-25',venue:'京都',raceNo:3,horseNo:5,horseName:'シュプレヒコール',status:'取消',sourceUrl:'https://www.jra.go.jp/news/202610/102503.html',proofKind:'reviewed-public-JRA-notice'};
 const body=JSON.stringify(proof);sql.prepare('INSERT INTO lab_card_withdrawals_v1 VALUES(?,?,?,?,?,?,?,?)').run(key,5,proof.horseName,proof.status,body,await sha256(body),'a'.repeat(64),'2026-10-25T14:06:54.430Z');
 const db={prepare(q){const w=(args=[])=>({bind(...a){return w(a)},async all(){return{results:sql.prepare(q).all(...args)}}});return w()}};
 const source={date:'2026-11-14',venue:'京都',raceNo:11,age:2,surface:'芝',distance:1600,snapshotId:'no-expected-supplement'};
 return{sql,db,source};
}
test('complete nine-entry result with one proved withdrawal compares eight starters and preserves original evidence',async()=>{
 const {sql,db,source}=await fixture();try{
  const direct=await historyForExpected(db,source,'コルサロ');
  assert.equal(direct.available,true);assert.equal(direct.recent[0].fieldSize,8);
  assert.equal(direct.recent[0].sourceEvidence.find(x=>x.provider==='official-result').values.fieldSize,9);
  assert.equal(direct.recent[0].sourceEvidence.find(x=>x.provider==='stored-profile-history').values.fieldSize,8);
  assert.ok(direct.recent[0].fieldSizeBasis.withdrawals[0].proofSha256);
  assert.deepEqual(direct.conflictDetails,[]);
  const batch=await postRaceHistoryBatch(db,{...source,raceKey:'2026-11-14:京都:11',runners:[{horse_name:'コルサロ',age:2}]});
  assert.deepEqual(await historyForExpected(null,source,'コルサロ',8,batch.get('コルサロ')),direct);
  assert.equal(sql.prepare('SELECT runner_count FROM jra_races').get().runner_count,9);
  assert.equal(sql.prepare('SELECT field_size FROM jra_past_performances').get().field_size,8);
 }finally{sql.close()}
});
test('partial results, missing or corrupt proof, wrong horse and unknown status retain field-size conflict',async()=>{
 for(const change of ["DELETE FROM lab_race_result_details WHERE horse_no=9","DELETE FROM lab_card_withdrawals_v1","UPDATE lab_card_withdrawals_v1 SET proof_sha256='bad'","UPDATE lab_card_withdrawals_v1 SET horse_name='別馬'","UPDATE lab_race_result_details SET finish_status='unknown' WHERE horse_no=9"]){
  const {sql,db,source}=await fixture();try{sql.exec(change);const h=await historyForExpected(db,source,'コルサロ');assert.equal(h.available,false,change);assert.ok(h.conflictDetails.some(x=>x.field==='fieldSize'));}finally{sql.close()}
 }
});
test('did-not-finish remains a starter and an unexplained profile count stays conflicting',async()=>{
 const {sql,db,source}=await fixture();try{
  sql.exec("UPDATE lab_race_result_details SET finish_status='did-not-finish',finish_position=NULL WHERE horse_no=9");
  assert.equal((await historyForExpected(db,source,'コルサロ')).recent[0].fieldSize,8);
  sql.exec('UPDATE jra_past_performances SET field_size=7');
  assert.equal((await historyForExpected(db,source,'コルサロ')).available,false);
 }finally{sql.close()}
});
test('the production inventory adapter passes reconciliation reads through and uses the reconciled batch',async()=>{
 const {rosterHistoryInventory}=await import('../src/roster-history-inventory.js');
 const {sql,db}=await fixture();try{
  sql.exec(`CREATE TABLE lab_expected_roster_registry(snapshot_id TEXT,race_key TEXT,record_json TEXT,stored_at TEXT);
  CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,surface TEXT,distance INTEGER);
  CREATE TABLE lab_expected_history_snapshots(horse_name TEXT,snapshot_id TEXT,race_date TEXT,payload_json TEXT);
  CREATE TABLE lab_provisional_predictions_v1(race_key TEXT,snapshot_sha256 TEXT,snapshot_json TEXT,saved_at TEXT);`);
  const record=JSON.stringify({date:'2026-11-14',venue:'京都',raceNo:11,runners:[{horseName:'コルサロ',age:2}]});
  sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?)').run(await sha256(record),'2026-11-14:京都:11',record,'2026-11-13T08:00:00Z');
  sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-11-14','京都',11,'芝',1600);
  const report=await rosterHistoryInventory(db,{from:'2026-11-14',to:'2026-11-14',raceKey:'2026-11-14:京都:11',asOf:'2026-11-13T08:30:00Z'},Date.parse('2026-11-13T08:31:00Z'));
  assert.equal(report.summary.conflictAppearances,0);
  assert.equal(report.races[0].horses[0].usableRecent,1);
  const input=report.currentShadowEvaluations[0].horses[0].primaryInput[0];
  assert.equal(input.fieldSize,8);assert.equal(input.sourceEvidence[0].values.fieldSize,9);
  assert.ok(input.fieldSizeBasis.withdrawals[0].proofSha256);
  assert.equal(report.dbWrites,0);assert.equal(report.externalSourceRequests,0);
 }finally{sql.close()}
});
