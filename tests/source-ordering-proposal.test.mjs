import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectLiveHistory} from '../src/live-source-dispatch.js';
import {collectMissingRoster} from '../src/missing-roster-acquisition.js';
import {recoverMissingPrograms} from '../src/program-recovery.js';
import {ensureCollectionTables} from '../src/history-collection-v3.37.0.js';
import {saveExpectedRoster} from '../src/expected-roster-registry.js';

const stamp=Date.parse('2026-10-22T00:30:50.951Z');
const html='<div>10/24(土) 東京 1R</div><a>競馬新聞</a><table><thead><tr><th>馬名</th><th>年齢</th></tr></thead><tbody><tr class="HorseList"><td><a href="https://own.netkeiba.com/db/horse.html?id=2024000001">隔離試験馬</a></td><td>牡2</td></tr></tbody></table><p>※結果・成績・オッズなどは主催者発表を確認</p>';
async function fixture(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async run(){queries.push(q);return{meta:{changes:Number(sql.prepare(q).run(...args).changes)}}},async first(){queries.push(q);return sql.prepare(q).get(...args)||null},async all(){queries.push(q);return{results:sql.prepare(q).all(...args)}}});return wrap()}};
 await ensureCollectionTables(db);
 sql.exec("CREATE TABLE jra_race_program(program_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,meeting_no INTEGER,day_no INTEGER,race_no INTEGER,race_label TEXT,surface TEXT,distance INTEGER,start_time TEXT,grade TEXT,source_url TEXT,fetched_at TEXT);INSERT INTO jra_race_program VALUES('2026-10-24:東京:1','2026-10-24','東京',4,8,1,'2歳未勝利','ダート',1400,'10:00',NULL,'https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html','2026-10-21T00:00:00.000Z');CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,race_key TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER);CREATE TABLE lab_expected_roster_registry(snapshot_id TEXT PRIMARY KEY,race_key TEXT,record_json TEXT,source_sha256 TEXT,stored_at TEXT)");
 return{db,sql,queries};
}
test('saved program allows roster acquisition before an unrelated calendar request consumes the shared slot',async t=>{
 const {db,sql,queries}=await fixture();let rosterFetch=0,programFetch=0;queries.length=0;
 const before=sql.prepare('SELECT * FROM jra_race_program').get();
 const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,
  programs:(db,deps)=>recoverMissingPrograms(db,{...deps,fetcher:async()=>{programFetch++;return new Response('',{status:403})}}),
  missing:(db,event,deps)=>collectMissingRoster(db,null,{...deps,fetcher:async()=>{rosterFetch++;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})}})});
 assert.equal(r.status,'roster-saved');assert.equal(rosterFetch,1);assert.equal(programFetch,0);assert.equal(r.externalRequests,1);
 assert.deepEqual(sql.prepare('SELECT * FROM jra_race_program').get(),before);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);t.diagnostic(JSON.stringify({localQueries:queries.length,externalRequests:rosterFetch+programFetch,d1RowsRead:'unmeasured'}));sql.close();
});
test('shared cooldown blocks both external sources without shortening or claiming the gate',async t=>{
 const {db,sql,queries}=await fixture(),gate=stamp+3600000;queries.length=0;
 sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=?,locked_until=?,lock_token='another-owner' WHERE name='jra-history'").run(gate,gate);
 const before=sql.prepare('SELECT * FROM lab_history_collection_budget').get();let programs=0;
 const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,programs:()=>{programs++;assert.fail('cannot try another external source')},missing:(db,event,deps)=>collectMissingRoster(db,null,{...deps,fetcher:()=>assert.fail('gate must prevent fetch')})});
 assert.equal(r.status,'cooldown');assert.equal(programs,0);assert.deepEqual(sql.prepare('SELECT * FROM lab_history_collection_budget').get(),before);t.diagnostic(JSON.stringify({localQueries:queries.length,externalRequests:0,d1RowsRead:'unmeasured'}));sql.close();
});
test('persisted roster readback recovers during external cooldown without refetch, INSERT or gate mutation',async t=>{
 const {db,sql,queries}=await fixture();
 const saved=await saveExpectedRoster(db,{date:'2026-10-24',venue:'東京',raceNo:1,provider:'netkeiba',kind:'expected-runners',sourceUrl:'https://race.netkeiba.com/race/shutuba.html?race_id=202605040801',observedAt:new Date(stamp).toISOString(),sourceText:'隔離試験の想定名簿根拠データ 隔離試験馬 2歳',runners:[{horseName:'隔離試験馬',age:2}]},stamp);
 sql.exec("CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT,next_at INTEGER,error TEXT);INSERT INTO lab_missing_roster_sources_v1 VALUES('2026-10-24:東京:1','pending-roster-readback',0,NULL)");
 sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=? WHERE name='jra-history'").run(stamp+3600000);
 const original=sql.prepare('SELECT * FROM lab_expected_roster_registry').get(),gate=sql.prepare('SELECT * FROM lab_history_collection_budget').get();queries.length=0;
 const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,programs:()=>assert.fail('readback must not wait for calendar'),missing:(db,event,deps)=>collectMissingRoster(db,null,{...deps,fetcher:()=>assert.fail('no fetch')})});
 assert.equal(r.status,'roster-reconciled');assert.equal(r.snapshotId,saved.snapshotId);assert.equal(r.savedAt,original.stored_at);assert.equal(r.snapshotSha256,original.snapshot_id);assert.equal(r.storedRunners,1);assert.equal(r.externalRequests,0);assert.equal(r.newRosterRaces,0);
 assert.deepEqual(sql.prepare('SELECT * FROM lab_expected_roster_registry').get(),original);assert.deepEqual(sql.prepare('SELECT * FROM lab_history_collection_budget').get(),gate);assert.equal(queries.some(q=>/INSERT.*lab_expected_roster_registry/i.test(q)),false);t.diagnostic(JSON.stringify({localQueries:queries.length,externalRequests:0,d1RowsRead:'unmeasured'}));sql.close();
});
test('no saved program means calendar recovery still receives the external slot',async()=>{
 const {db,sql}=await fixture();sql.exec('DELETE FROM jra_race_program');let calls=0;
 const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,programs:(db,deps)=>recoverMissingPrograms(db,{...deps,fetcher:async()=>{calls++;return new Response('',{status:403})}}),missing:(db,event,deps)=>collectMissingRoster(db,null,{...deps,fetcher:()=>assert.fail('no roster without program')})});
 assert.equal(r.status,'source-unconfirmed');assert.equal(calls,1);assert.equal(r.externalRequests,1);assert.equal(r.meetingAbsenceInferred,false);sql.close();
});
test('72-slot metadata replay excludes the 21 saved rosters and advances across all three venues',async()=>{
 const {db,sql}=await fixture();sql.exec('DELETE FROM jra_race_program');
 // Only saved/missing metadata from the approved GET is replayed here. These
 // placeholder rows do not represent entrant data or production persistence.
 const saved={'2026-10-24:東京':[9,10,11],'2026-10-25:東京':[9,10,11],'2026-10-24:京都':[9,10,11],'2026-10-25:京都':[8,9,10,11,12],'2026-10-24:新潟':[1,9,10,11],'2026-10-25:新潟':[9,10,11]};
 for(const date of ['2026-10-24','2026-10-25'])for(const venue of ['東京','京都','新潟'])for(let n=1;n<=12;n++){
  const key=`${date}:${venue}:${n}`;sql.prepare('INSERT INTO jra_race_program(program_key,race_date,venue,meeting_no,day_no,race_no,fetched_at) VALUES(?,?,?,?,?,?,?)').run(key,date,venue,4,8,n,new Date(stamp).toISOString());
  if(saved[`${date}:${venue}`].includes(n))sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?,?)').run(key,key,'metadata-only-placeholder','metadata-only-placeholder',new Date(stamp).toISOString());
 }
 sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=? WHERE name='jra-history'").run(stamp+3600000);
 sql.exec("CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT,next_at INTEGER,source_url TEXT,body_html TEXT,body_sha256 TEXT,observed_at TEXT,error TEXT);INSERT INTO lab_missing_roster_sources_v1(race_key,status,next_at) VALUES('2026-10-24:京都:1','fetch-failed',1)");
 assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,21);
 const selected=[];for(let i=0;i<4;i++){
  const r=await collectMissingRoster(db,null,{now:()=>stamp,fetcher:()=>assert.fail('metadata replay must never fetch')});assert.equal(r.status,'cooldown');selected.push(r.target);
  sql.prepare("INSERT INTO lab_missing_roster_sources_v1(race_key,status,next_at) VALUES(?,'source-blocked',?) ON CONFLICT(race_key) DO UPDATE SET next_at=excluded.next_at,status=excluded.status").run(r.target,stamp+3600000);
 }
 assert.deepEqual(selected,['2026-10-24:京都:1','2026-10-24:東京:1','2026-10-24:京都:2','2026-10-24:新潟:2']);sql.close();
});
