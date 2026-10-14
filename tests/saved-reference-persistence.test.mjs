import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import app from '../src/index-v3.8.9.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {ensureEvidenceTable,sha256,runnerFingerprint} from '../src/card-evidence.js';
import {collectLockedMarkResults,readLockedMarkResults} from '../src/locked-mark-result-evidence.js';
import {lockUserMark,readUserMarkLock} from '../src/user-mark-lock.js';

test('formal save, hash readback and immutable LOCK retain all-runner reference scores and symbols',async()=>{
 const sql=new DatabaseSync(':memory:'),key='2030-10-18:東京:11',at=new Date().toISOString();
 const db={prepare(q){const wrap=(a=[])=>({bind(...x){return wrap(x)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}});return wrap()},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 try {
 sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER,fetched_at TEXT);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,frame_no INTEGER,horse_name TEXT,sex TEXT,age INTEGER,assigned_weight REAL,jockey TEXT,trainer TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT);');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?,?,?)').run(key,'2030-10-18','東京',11,'試験','芝',1600,2,at);
 const runners=[{horse_no:1,frame_no:1,horse_name:'馬A'},{horse_no:2,frame_no:2,horse_name:'馬B'}];
 for(const r of runners)sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?,?,?,?,?,?)').run(key,r.horse_no,r.frame_no,r.horse_name,'牡',4,57,'騎手','調教師');
 await ensureHistoryTable(db);await ensureEvidenceTable(db);
 sql.prepare('INSERT INTO lab_card_source_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(key,'https://www.jra.go.jp/card','a'.repeat(64),await sha256(runnerFingerprint(runners)),2,2,2,1,1,at,at,'explicit-label');
 for(const r of runners)for(let i=1;i<=3;i++)sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.horse_name,'2030-0'+i+'-01','東京','前走','芝',1600,r.horse_no,10,'良','https://www.jra.go.jp/result',at);
 const response=await app.fetch(new Request('https://test/v1/lab/user-marks',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-token'},body:JSON.stringify({date:'2030-10-18',venue:'東京',raceNo:11,phase:'final',track:'良',confirm:'SAVE',marks:[{horseNo:1,mark:'◎'}]})}),{DB:db,USER_MARK_WRITE_TOKEN:'test-token'},{});
 const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));
 const stored=sql.prepare('SELECT * FROM lab_user_mark_revisions WHERE revision_id=?').get(saved.revisionId);
 assert.equal(await sha256(stored.audit_json),stored.audit_sha256);
 const audit=JSON.parse(stored.audit_json).audit;
 assert.equal(audit.referenceAssessment.allRunners.length,2);
 assert.equal(audit.referenceAssessment.allRunners[0].mark,'◎');
 assert.equal(audit.marked[0].laboReferenceMark,'◎');assert.equal(audit.summary.unscored,0);
 const lock=await lockUserMark(db,{date:'2030-10-18',venue:'東京',raceNo:11,phase:'final',revisionId:saved.revisionId});
 assert.equal((await readUserMarkLock(db,key,'final')).snapshotSha256,lock.snapshotSha256);
 const snapshot=JSON.parse(sql.prepare('SELECT snapshot_json FROM lab_user_mark_locks').get().snapshot_json);
 assert.equal(snapshot.auditSha256,stored.audit_sha256);
 assert.throws(()=>sql.exec("UPDATE lab_user_mark_revisions SET audit_json='{}'"),/immutable/);
 sql.exec('CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,finish_status TEXT,source_url TEXT,source_sha256 TEXT)');
 assert.equal((await collectLockedMarkResults(db)).waiting[0].reason,'awaiting-complete-results');
 for(const r of runners)sql.prepare('INSERT INTO lab_race_result_details VALUES(?,?,?,?,?,?,?)').run(key,r.horse_no,r.horse_name,3-r.horse_no,'finished','https://www.jra.go.jp/result','b'.repeat(64));
 const collected=await collectLockedMarkResults(db);assert.equal(collected.saved,1,JSON.stringify(collected));
 let evidence=await readLockedMarkResults(db,key,'final');assert.equal(evidence[0].rows[0].rankGap,1);assert.equal(evidence[0].rows[0].userMark,'◎');
 assert.equal((await collectLockedMarkResults(db)).saved,0);
 assert.throws(()=>sql.exec("DELETE FROM lab_locked_mark_results"),/immutable/);
 sql.exec("UPDATE lab_race_result_details SET horse_name='別馬' WHERE horse_no=1");
 assert.equal((await collectLockedMarkResults(db)).waiting[0].reason,'result-identity-or-source-unverified');
 sql.exec("UPDATE lab_race_result_details SET horse_name='馬A',finish_position=NULL,finish_status='scratched',source_sha256='"+'c'.repeat(64)+"' WHERE horse_no=1");
 assert.equal((await collectLockedMarkResults(db)).saved,0); // Mixed source revisions cannot be combined.
 sql.exec("UPDATE lab_race_result_details SET source_sha256='"+'c'.repeat(64)+"'");
 assert.equal((await collectLockedMarkResults(db)).saved,1);
 evidence=await readLockedMarkResults(db,key,'final');assert.equal(evidence.length,2);assert.equal(evidence[0].rows[0].rankGap,null);

 } finally {sql.close()}
});
