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
 sql.exec(`CREATE TABLE jra_race_program(program_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,race_no INTEGER,meeting_no INTEGER,day_no INTEGER,race_label TEXT);INSERT INTO jra_race_program VALUES('${key}','2026-10-31','京都',1,4,10,'2歳未勝利');CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,race_key TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER);CREATE TABLE lab_expected_roster_registry(race_key TEXT);CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER,lock_token TEXT);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0,NULL)`);
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

test('non-200 response evidence survives independent READ without promoting error HTML to a roster',async()=>{
 // The real Kyoto5 response body was discarded; this body is an isolated regression input.
 const {db,sql,queries}=fixture(),body='<title>Bad Request</title><p>Request rejected</p>';let calls=0;
 const failure=await collectMissingRoster(db,target,{now:()=>now,fetcher:async(url,options)=>{calls++;assert.equal(url,'https://race.netkeiba.com/race/shutuba.html?race_id=202608041001');assert.equal(options.redirect,'manual');return new Response(body,{status:400,headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(failure.status,'fetch-failed');assert.equal(failure.httpStatus,400);assert.equal(failure.saveMayHaveSucceeded,false);assert.equal(calls,1);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);
 const before=sql.prepare('SELECT * FROM lab_missing_roster_sources_v1').get();queries.length=0;
 const read=await readMissingRosterEvidence(db,{...target,includeBody:true});assert.equal(read.bodyHtml,body);assert.equal(read.bodySha256,await sha256(body));assert.equal(read.responseEvidence.bodyComplete,true);assert.equal(read.responseEvidence.rawBytesStored,new TextEncoder().encode(body).length);assert.equal(read.responseEvidence.requestRedirect,'manual');assert.equal(read.charsetRecorded,true);assert.equal(read.observedAt,new Date(now).toISOString());assert.equal(read.error,'netkeiba HTTP 400');assert.equal(queries.length,1);assert.deepEqual(sql.prepare('SELECT * FROM lab_missing_roster_sources_v1').get(),before);
 const wait=await collectMissingRoster(db,target,{now:()=>now+1,fetcher:()=>assert.fail('no forced retry')});assert.equal(wait.externalRequests,0);assert.equal(calls,1);sql.close();
});

test('failed response body is capped and marked partial while 403 cooldown remains unchanged',async()=>{
 const {db,sql}=fixture(),body='x'.repeat(70000);let calls=0;
 const r=await collectMissingRoster(db,target,{now:()=>now,fetcher:async()=>{calls++;return new Response(body,{status:403,headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(r.status,'source-blocked');assert.equal(r.failureEvidence.bodyComplete,false);assert.equal(r.failureEvidence.rawBytesStored,65536);assert.equal(r.failureEvidence.maxRawBytes,65536);assert.equal(calls,1);assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,now+3600000);
 const read=await readMissingRosterEvidence(db,{...target,includeBody:true});assert.equal(read.bodyHtml.length,65536);assert.equal(read.bodySha256,await sha256(body.slice(0,65536)));assert.notEqual(read.bodySha256,await sha256(body));assert.equal(read.responseEvidence.bodyComplete,false);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);sql.close();
});
