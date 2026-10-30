import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectMissingRoster} from '../src/missing-roster-acquisition.js';

const hour=3600000,stamp=Date.parse('2026-10-26T00:00:00Z');
function fixture(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 sql.exec(`CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,meeting_no INTEGER,day_no INTEGER,race_label TEXT,fetched_at TEXT);
 CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,race_key TEXT,runner_count INTEGER);
 CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER);
 CREATE TABLE lab_expected_roster_registry(snapshot_id TEXT PRIMARY KEY,race_key TEXT,record_json TEXT,source_sha256 TEXT,stored_at TEXT);
 CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER,lock_token TEXT);
 INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0,NULL);
 CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,source_url TEXT,http_status INTEGER,body_sha256 TEXT,body_html TEXT,observed_at TEXT,error TEXT);
 CREATE TABLE lab_missing_roster_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
 INSERT INTO lab_missing_roster_clock_v1 VALUES('source',0);`);
 const db={prepare(q){queries.push(q);const w=(a=[])=>({bind(...v){return w(v)},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}}});return w()}};
 const add=(date,venue,n,nextAt=null)=>{
  const key=`${date}:${venue}:${n}`;
  sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?,?,?)').run(date,venue,n,4,date==='2026-10-31'?10:11,'未勝利','2026-10-25T00:00:00.000Z');
  if(nextAt!==null)sql.prepare('INSERT INTO lab_missing_roster_sources_v1(race_key,status,next_at,source_url) VALUES(?,?,?,?)').run(key,'publication-unconfirmed',nextAt,'https://race.netkeiba.com/race/shutuba.html?race_id=legacy');
  return key;
 };
 const run=async at=>collectMissingRoster(db,null,{now:()=>at,fetcher:async()=>new Response('<html><title>no named candidates</title></html>',{headers:{'content-type':'text/html;charset=utf-8'}})});
 return{sql,db,queries,add,run};
}

test('Oct 31 overdue candidates precede untried Nov 1, while both dates and retries receive turns',async t=>{
 const f=fixture();
 for(const date of ['2026-10-31','2026-11-01'])for(const venue of ['東京','京都'])for(let n=1;n<=12;n++){
  const saved=date==='2026-10-31'?n>=9&&n<=11:venue==='東京'&&n===11;
  const key=f.add(date,venue,n,date==='2026-10-31'&&!saved?stamp-30*hour:null);
  if(saved)f.sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?,?)').run(key,key,'preserved snapshot','preserved SHA','preserved timestamp');
 }
 const before=f.sql.prepare('SELECT * FROM lab_expected_roster_registry ORDER BY race_key').all(),seen=new Set(),selected=[];
 for(let slot=0;slot<60;slot++){
  const result=await f.run(stamp+slot*hour);
  assert.equal(result.externalRequests,1);assert.equal(result.status,'publication-unconfirmed');
  selected.push(result.target);seen.add(result.target);
 }
 assert.equal(selected[0],'2026-10-31:京都:1');
 assert.ok(selected.slice(0,18).every(key=>key.startsWith('2026-10-31:')));
 t.diagnostic(JSON.stringify({localNaturalSlots:selected.length,firstNov1Slot:selected.findIndex(k=>k.startsWith('2026-11-01:'))+1,uniqueUnsavedTargets:seen.size,production:false}));
 assert.equal(seen.size,41,'all unsaved races must receive a turn despite repeated failures');
 assert.ok(selected.length>seen.size,'test must exercise retry competition, not just successful removals');
 assert.deepEqual(f.sql.prepare('SELECT * FROM lab_expected_roster_registry ORDER BY race_key').all(),before);
 f.sql.close();
});

test('a sufficiently old Nov 1 retry overtakes a recently attempted Oct 31 race',async()=>{
 const f=fixture();f.add('2026-10-31','東京',1,stamp-hour);f.add('2026-11-01','京都',1,stamp-48*hour);
 assert.equal((await f.run(stamp)).target,'2026-11-01:京都:1');f.sql.close();
});

test('same-date untried candidates are not displaced forever by a failing lower race number',async()=>{
 const f=fixture();f.add('2026-10-31','東京',1,stamp-30*hour);f.add('2026-10-31','東京',2);
 assert.equal((await f.run(stamp)).target,'2026-10-31:東京:1');
 assert.equal((await f.run(stamp+hour)).target,'2026-10-31:東京:2');f.sql.close();
});

test('deadline priority never makes a retry executable before its existing next_at',async()=>{
 const f=fixture();const key=f.add('2026-10-31','東京',1,stamp+hour);f.add('2026-11-01','京都',1);
 assert.equal((await f.run(stamp)).target,'2026-11-01:京都:1');
 assert.equal(f.sql.prepare('SELECT next_at FROM lab_missing_roster_sources_v1 WHERE race_key=?').get(key).next_at,stamp+hour);f.sql.close();
});

test('eligible deadline candidate still obeys shared cooldown, lease, hourly clock and 403 wait',async()=>{
 for(const control of ['next_batch_at','locked_until','source-clock']){
  const f=fixture();f.add('2026-10-31','東京',1,stamp-hour);
  if(control==='source-clock')f.sql.prepare("UPDATE lab_missing_roster_clock_v1 SET next_at=?").run(stamp+hour);
  else f.sql.prepare(`UPDATE lab_history_collection_budget SET ${control}=?`).run(stamp+hour);
  const r=await collectMissingRoster(f.db,null,{now:()=>stamp,fetcher:()=>assert.fail('blocked candidate must not fetch')});
  assert.equal(r.externalRequests,0);assert.equal(r.status,control==='source-clock'?'source-not-due':'cooldown');f.sql.close();
 }
 const f=fixture();f.add('2026-10-31','東京',1,stamp-hour);let calls=0;
 const r=await collectMissingRoster(f.db,null,{now:()=>stamp,fetcher:async()=>{calls++;return new Response('',{status:403})}});
 assert.equal(r.status,'source-blocked');assert.equal(calls,1);
 assert.equal(f.sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,stamp+hour);f.sql.close();
});
