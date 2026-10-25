import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import app from '../src/index-v3.49.0.js';
import {collectMissingRoster} from '../src/missing-roster-acquisition.js';
import {readMissingRosterEvidence} from '../src/missing-roster-evidence.js';
import {sha256} from '../src/card-evidence.js';
const target={date:'2026-10-31',venue:'京都',raceNo:1},key='2026-10-31:京都:1',now=Date.parse('2026-10-26T00:00:00Z');
// Synthetic failure response; the real Oct26 response body is still unavailable.
const html='<meta charset="euc-jp"><title>合成・未公開ページ</title><a href="?kaisai_date=20261024&race_id=202608040901">先週の出馬表</a><p>4回京都9日</p>';
function fixture(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 sql.exec(`CREATE TABLE jra_race_program(program_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,race_no INTEGER,meeting_no INTEGER,day_no INTEGER,race_label TEXT);INSERT INTO jra_race_program VALUES('${key}','2026-10-31','京都',1,4,10,'2歳未勝利');CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER);CREATE TABLE lab_expected_roster_registry(race_key TEXT);CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER,lock_token TEXT);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0,NULL)`);
 const db={prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async run(){queries.push(q);return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){queries.push(q);return sql.prepare(q).get(...a)||null},async all(){queries.push(q);return{results:sql.prepare(q).all(...a),meta:{rows_read:1,rows_written:0}}}});return w()}};
 return{sql,db,queries};
}
test('failed natural collector response can be read by exact key without refetch or modifying its receipt',async()=>{
 const {db,sql,queries}=fixture();let calls=0;const failure=await collectMissingRoster(db,target,{now:()=>now,fetcher:async()=>{calls++;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})}});assert.equal(failure.status,'publication-unconfirmed');
 const before=sql.prepare('SELECT * FROM lab_missing_roster_sources_v1').get();queries.length=0;
 const r=await readMissingRosterEvidence(db,{...target,includeBody:true});assert.equal(r.integrityVerified,true);assert.equal(r.bodyHtml,html);assert.equal(r.bodySha256,await sha256(html));assert.deepEqual(r.parserIdentityChecks,{raceId:false,date:false,meeting:false});assert.deepEqual(r.observedCalendarDates,['20261024']);assert.deepEqual(r.observedRaceIds,['202608040901']);assert.equal(r.charsetRecorded,false);assert.equal(calls,1);assert.equal(queries.length,1);assert.match(queries[0],/^SELECT/);assert.deepEqual(sql.prepare('SELECT * FROM lab_missing_roster_sources_v1').get(),before);
 const other=await readMissingRosterEvidence(db,{...target,raceNo:2,includeBody:true});assert.equal(other.available,false);assert.equal(other.bodyHtml,undefined);sql.close();
});
test('explicit HTTP diagnostic has one indexed read, optional body, and rejects writes or unscoped reads before DB',async()=>{
 const {db,sql,queries}=fixture();await collectMissingRoster(db,target,{now:()=>now,fetcher:async()=>new Response(html)});queries.length=0;
 const u='https://test/v1/lab/missing-roster-evidence?confirm=READ_STORED_SOURCE&date=2026-10-31&venue='+encodeURIComponent('京都')+'&race_no=1';
 const r=await app.fetch(new Request(u),{DB:db},{}),j=await r.json();assert.equal(r.status,200);assert.equal(j.bodyHtml,undefined);assert.equal(j.integrityVerified,true);assert.equal(j.metrics.queries,1);assert.equal(j.metrics.rowsWritten,0);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(queries.length,1);
 queries.length=0;assert.equal((await app.fetch(new Request(u,{method:'POST'}),{DB:db},{})).status,405);assert.equal((await app.fetch(new Request('https://test/v1/lab/missing-roster-evidence'),{DB:db},{})).status,400);assert.equal((await app.fetch(new Request(u.replace('race_no=1','race_no=99')),{DB:db},{})).status,409);assert.equal(queries.length,0);
 sql.exec("UPDATE lab_missing_roster_sources_v1 SET body_html='tampered'");await assert.rejects(readMissingRosterEvidence(db,target),/hash mismatch/);sql.close();
});
