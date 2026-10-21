import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {rosterHistoryInventory} from '../src/roster-history-inventory.js';import {sha256} from '../src/card-evidence.js';
test('seven SELECTs inventory repeated identities, sparse history and conflicts without writes or prediction rebuild',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(`
 CREATE TABLE lab_expected_roster_registry(snapshot_id TEXT,race_key TEXT,record_json TEXT,stored_at TEXT);
 CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,surface TEXT,distance INTEGER);
 CREATE TABLE jra_runners(horse_name TEXT,race_key TEXT,horse_no INTEGER,age INTEGER);
 CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,runner_count INTEGER,race_no INTEGER);
 CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);
 CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT);
 CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,finish_position INTEGER,field_size INTEGER,time_text TEXT,last3f REAL,corner_positions TEXT,track_condition TEXT,source_url TEXT);
 CREATE TABLE lab_prior_detail_evidence(detail_json TEXT,result_url TEXT,fetched_at TEXT);
 CREATE TABLE lab_expected_history_snapshots(horse_name TEXT,snapshot_id TEXT,race_date TEXT,payload_json TEXT);
 CREATE TABLE lab_provisional_predictions_v1(race_key TEXT,snapshot_sha256 TEXT,snapshot_json TEXT,saved_at TEXT);`);
 const sources=[{date:'2026-10-24',venue:'東京',raceNo:1,runners:['A','B','C','D'].map(horseName=>({horseName,age:3}))},{date:'2026-10-25',venue:'京都',raceNo:2,runners:[{horseName:'A',age:3}]}];
 for(const s of sources){const json=JSON.stringify(s),hash=await sha256(json);sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?)').run(hash,`${s.date}:${s.venue}:${s.raceNo}`,json,'2026-10-21T07:00:00Z');sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(s.date,s.venue,s.raceNo,'芝',1600);
 for(const r of s.runners)for(let i=0;i<(r.horseName==='D'?0:r.horseName==='B'?1:3);i++){const p={race_date:`2026-09-0${i+1}`,venue:'東京',race_name:'past',surface:'芝',distance:1600,finish_position:2,field_size:10,last3f:34,corner_positions:'2-2',source_url:'https://race.netkeiba.com/'};sql.prepare('INSERT INTO lab_expected_history_snapshots VALUES(?,?,?,?)').run(r.horseName,'registered:'+hash,p.race_date,JSON.stringify(p));}}
 sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,finish_position,field_size,surface,distance) VALUES(?,?,?,?,?,?,?)').run('C','2026-09-01','東京',9,10,'芝',1600);
 let calls=0;const db={prepare(q){assert.match(q,/^\s*(SELECT|WITH)/);calls++;return{bind(...args){return{async all(){return{results:sql.prepare(q).all(...args)}}}}}}};
 const result=await rosterHistoryInventory(db,{from:'2026-10-24',to:'2026-10-25',asOf:'2026-10-21T08:37:36Z'},Date.parse('2026-10-21T10:00:00Z'));
 assert.equal(calls,7);assert.equal(result.summary.appearances,5);assert.equal(result.summary.uniqueHorses,4);assert.equal(result.summary.uniqueStoredRuns,7);assert.equal(result.summary.readyAppearances,2);assert.equal(result.summary.insufficientAppearances,2);assert.equal(result.summary.conflictAppearances,1);assert.equal(result.summary.zeroHistoryAppearances,1);assert.equal(result.races.flatMap(r=>r.horses).find(h=>h.horseName==='C').conflictDetails[0].field,'finish');
 assert.equal(result.savedPredictions.length,0);assert.equal(result.dbWrites,0);
 const one=await rosterHistoryInventory(db,{from:'2026-10-24',to:'2026-10-25',asOf:'2026-10-21T08:37:36Z',raceKey:'2026-10-24:東京:1'},Date.parse('2026-10-21T10:00:00Z'));assert.equal(one.summary.rosters,1);assert.equal(one.summary.appearances,4);assert.equal(calls,14);sql.close();
});
test('out-of-scope or invalid dates reject before DB access',async()=>{
 const db={prepare(){throw Error('DB must not be touched')}};for(const input of [{from:'2026-10-01',to:'2026-10-25',asOf:'2026-10-21'},{from:'bad',to:'2026-10-25',asOf:'2026-10-21'}])await assert.rejects(rosterHistoryInventory(db,input,Date.parse('2026-10-21')));
});
