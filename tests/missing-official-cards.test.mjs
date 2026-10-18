import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {missingOfficialCards,collectMissingOfficialCard} from '../src/missing-official-cards.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT);CREATE TABLE lab_history_collection_budget(name TEXT,next_batch_at INTEGER);INSERT INTO lab_history_collection_budget VALUES('jra-history',0);");const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(q).all(...args)}},async first(){return sql.prepare(q).get(...args)||null}});return wrap()}};return{sql,db};}
const now=Date.parse('2026-10-18T05:15:00Z'),date='2026-10-18';
const card='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0104202604021120261018/AA';
test('missing cards use stored program links and prioritize upcoming races without refetching complete cards',async()=>{
 const {sql,db}=fixture();const put=sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)');
 put.run(date,'新潟',11,'15:20',card);put.run(date,'新潟',4,'11:20','https://www.jra.go.jp/calendar');put.run(date,'京都',11,'15:40','https://www.jra.go.jp/calendar');sql.exec("INSERT INTO jra_races VALUES('complete','2026-10-18','京都',11,1);INSERT INTO jra_runners VALUES('complete')");
 assert.equal((await missingOfficialCards(db,date,now)).missing.length,2);let source;
 const r=await collectMissingOfficialCard(db,{date},{now:()=>now,discover:async(_db,s)=>{source=s;return{ok:true,status:'official-card-saved',externalRequests:1}}});
 assert.equal(r.target.venue,'新潟');assert.equal(r.target.raceNo,11);assert.equal(source.officialCardUrl,card);assert.equal(r.predictionRebuilt,false);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=?').run(now+3600000);
 const blocked=await collectMissingOfficialCard(db,{date},{now:()=>now,discover:()=>{throw Error('must not fetch')}});assert.equal(blocked.status,'cooldown');assert.equal(blocked.externalRequests,0);sql.close();
});
