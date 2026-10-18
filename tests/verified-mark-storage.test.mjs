import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sha256} from '../src/card-evidence.js';
import {commitVerifiedMarks} from '../src/verified-mark-storage.js';

async function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE lab_user_mark_revisions(revision_id TEXT PRIMARY KEY,race_key TEXT,phase TEXT,revision_no INTEGER,mark_payload_sha256 TEXT,audit_sha256 TEXT,audit_json TEXT);CREATE TABLE lab_user_mark_entries(revision_id TEXT,race_key TEXT,phase TEXT,horse_no INTEGER,horse_name TEXT,mark TEXT,note TEXT,ordinal INTEGER);');
 const calls={writes:0,reads:0};
 const db={prepare(query){const wrap=(args=[])=>({bind(...a){return wrap(a)},async first(){calls.reads++;return sql.prepare(query).get(...args)||null},async all(){calls.reads++;return{results:sql.prepare(query).all(...args)}},async run(){sql.prepare(query).run(...args)}});return wrap()},async batch(statements){calls.writes++;sql.exec('BEGIN');try{for(const statement of statements)await statement.run();sql.exec('COMMIT')}catch(error){sql.exec('ROLLBACK');throw error}}};
 const auditJson=JSON.stringify({race:{raceKey:'2026-10-18:京都:11'},audit:{marked:[{horseName:'馬A',mark:'◎'}]}});
 const expected={revisionId:'revision-1',raceKey:'2026-10-18:京都:11',phase:'final',revisionNo:1,markPayloadSha256:'payload-hash',auditSha256:await sha256(auditJson),auditJson,marks:[{horseNo:8,horseName:'馬A',mark:'◎',note:null,ordinal:1}]};
 const statements=[db.prepare('INSERT INTO lab_user_mark_revisions VALUES(?,?,?,?,?,?,?)').bind(expected.revisionId,expected.raceKey,expected.phase,1,expected.markPayloadSha256,expected.auditSha256,auditJson),db.prepare('INSERT INTO lab_user_mark_entries VALUES(?,?,?,?,?,?,?,?)').bind(expected.revisionId,expected.raceKey,expected.phase,8,'馬A','◎',null,1)];
 return{db,sql,calls,expected,statements};
}

test('a successful save requires exact persisted revision, audit hash and all marked entries',async()=>{
 const f=await fixture();
 const r=await commitVerifiedMarks(f.db,f.statements,f.expected);
 assert.equal(r.verified,true);assert.equal(r.markedEntries,1);assert.equal(r.auditSha256,f.expected.auditSha256);
 assert.deepEqual(f.calls,{writes:1,reads:2});f.sql.close();
});

test('missing or changed DB rows cannot be reported as a verified save',async()=>{
 for(const change of ["DELETE FROM lab_user_mark_entries","UPDATE lab_user_mark_entries SET mark='消'","UPDATE lab_user_mark_revisions SET audit_json='{}'","UPDATE lab_user_mark_entries SET ordinal=2"]){
  const f=await fixture(),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{await batch(statements);f.sql.exec(change)};
  const result=await commitVerifiedMarks(f.db,f.statements,f.expected);
  assert.equal(result.verified,false);assert.match(result.reason,/mismatch/);assert.equal(f.calls.writes,1);f.sql.close();
 }
});

test('readback failure leaves an accepted write intact and performs no second write',async()=>{
 const f=await fixture(),batch=f.db.batch.bind(f.db);
 f.db.batch=async statements=>{await batch(statements);f.db.prepare=()=>{throw Error('D1 read limit')}};
 const result=await commitVerifiedMarks(f.db,f.statements,f.expected);
 assert.deepEqual(result,{verified:false,reason:'readback-unavailable'});
 assert.equal(f.calls.writes,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM lab_user_mark_entries').get().n,1);f.sql.close();
});

test('non-atomic storage and an invalid outgoing audit are rejected before any write',async()=>{
 const f=await fixture();
 await assert.rejects(()=>commitVerifiedMarks({...f.db,batch:undefined},f.statements,f.expected),/atomic/);
 await assert.rejects(()=>commitVerifiedMarks(f.db,f.statements,{...f.expected,auditSha256:'invalid'}),/hash mismatch/);
 assert.equal(f.calls.writes,0);f.sql.close();
});
