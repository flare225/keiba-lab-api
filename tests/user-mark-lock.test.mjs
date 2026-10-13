import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {lockDeadline,lockUserMark,readUserMarkLock,userMarkLockEndpoint} from '../src/user-mark-lock.js';
import {sha256,runnerFingerprint} from '../src/card-evidence.js';
test('JST deadline rejects past, unknown same-day time and post time; permits future-day and confirmed pre-start',()=>{
 const n=Date.parse('2030-10-13T03:00:00Z');
 assert.throws(()=>lockDeadline('2030-10-12','15:00',n),/過去/);
 assert.throws(()=>lockDeadline('2030-10-13',null,n),/未確認/);
 assert.throws(()=>lockDeadline('2030-10-13','12:00',n),/発走/);
 assert.equal(lockDeadline('2030-10-13','15:00',n),'2030-10-13T06:00:00.000Z');
 assert.equal(lockDeadline('2030-10-14',null,n),'2030-10-13T15:00:00.000Z');
});
async function fixture(){
 const sql=new DatabaseSync(':memory:'),key='2030-10-14:東京:11',now=Date.parse('2030-10-13T03:00:00Z'),at=new Date(now-1000).toISOString();
 sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER,fetched_at TEXT);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,frame_no INTEGER,horse_name TEXT);CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT);CREATE TABLE lab_user_mark_revisions(race_key TEXT,phase TEXT,revision_id TEXT,revision_no INTEGER,audit_json TEXT,audit_sha256 TEXT,created_at TEXT);CREATE TABLE lab_user_mark_entries(revision_id TEXT,horse_no INTEGER,horse_name TEXT,mark TEXT,note TEXT,ordinal INTEGER);CREATE TABLE lab_race_outcomes(race_key TEXT,finish_position INTEGER);CREATE TABLE lab_card_source_evidence(race_key TEXT,card_fetched_at TEXT,runner_sha256 TEXT,horse_numbers_observed INTEGER,frames_observed INTEGER,declared_count INTEGER,parsed_count INTEGER,source_row_count INTEGER);');
 const runners=[{horse_no:1,frame_no:1,horse_name:'馬A'}],audit=JSON.stringify({race:{date:'2030-10-14'},phase:'final',audit:{marked:[{horseNo:1,horseName:'馬A',mark:'◎',note:null}]}});
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run(key,'2030-10-14','東京',11,1,at);
 sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(key,1,1,'馬A');
 sql.prepare('INSERT INTO lab_user_mark_revisions VALUES(?,?,?,?,?,?,?)').run(key,'final','r1',1,audit,await sha256(audit),at);
 sql.exec("INSERT INTO lab_user_mark_entries VALUES('r1',1,'馬A','◎',NULL,1)");
 sql.prepare('INSERT INTO lab_card_source_evidence VALUES(?,?,?,?,?,?,?,?)').run(key,at,await sha256(runnerFingerprint(runners)),1,1,1,1,1);
 const db={prepare(q){const wrap=(a=[])=>({bind(...x){return wrap(x)},async first(){return sql.prepare(q).get(...a)||null},async all(){return {results:sql.prepare(q).all(...a)}},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}});return wrap();}};
 return {sql,db,key,now,input:{date:'2030-10-14',venue:'東京',raceNo:11,phase:'final',revisionId:'r1'}};
}
test('verified latest marks lock once, read back exact hash and resist update/delete',async()=>{
 const f=await fixture(),a=await lockUserMark(f.db,f.input,f.now),b=await lockUserMark(f.db,f.input,f.now);
 assert.equal(a.stage,'user-mark-lock-verified');assert.equal(b.idempotent,true);assert.equal(a.snapshotSha256,b.snapshotSha256);
 assert.equal((await readUserMarkLock(f.db,f.key,'final')).revisionId,'r1');
 assert.throws(()=>f.sql.exec("UPDATE lab_user_mark_locks SET revision_id='other'"),/immutable/);
 assert.throws(()=>f.sql.exec('DELETE FROM lab_user_mark_locks'),/immutable/);f.sql.close();
});
test('old revisions, changed entries, card mismatch and stored outcomes are rejected',async()=>{
 for(const mutate of [f=>f.input.revisionId='old',f=>f.sql.exec("UPDATE lab_user_mark_entries SET mark='消'"),f=>f.sql.exec("UPDATE lab_card_source_evidence SET runner_sha256='changed'"),f=>f.sql.prepare('INSERT INTO lab_race_outcomes VALUES(?,1)').run(f.key)]){
 const f=await fixture();mutate(f);await assert.rejects(()=>lockUserMark(f.db,f.input,f.now));f.sql.close();
 }
});
test('anonymous lock never reaches database',async()=>{
 const r=await userMarkLockEndpoint(new Request('https://x/v1/lab/user-mark-lock',{method:'POST',body:'{}'}),{USER_MARK_WRITE_TOKEN:'x'.repeat(32),DB:{prepare(){throw Error('unexpected database')}}});
 assert.equal(r.status,401);
});

test('a result or roster change after verification cannot slip through atomic insertion',async()=>{
 for(const kind of ['outcomes','roster','revision']){
  const f=await fixture(),prepare=f.db.prepare.bind(f.db);
  f.db.prepare=q=>{
   if(q.startsWith('INSERT OR IGNORE INTO lab_user_mark_locks')){
    if(kind==='outcomes')f.sql.prepare('INSERT INTO lab_race_outcomes VALUES(?,1)').run(f.key);
    if(kind==='roster')f.sql.exec("UPDATE jra_runners SET horse_name='別馬'");
    if(kind==='revision')f.sql.exec("INSERT INTO lab_user_mark_revisions SELECT race_key,phase,'r2',2,audit_json,audit_sha256,created_at FROM lab_user_mark_revisions");
   }
   return prepare(q);
  };
  await assert.rejects(()=>lockUserMark(f.db,f.input,f.now),/固定を確認できません/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM lab_user_mark_locks').get().n,0);f.sql.close();
 }
});
