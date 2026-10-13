import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseOfficialResultDetails,ensureResultDetailTables} from '../src/result-detail-v3.33.0.js';
import {collectRichResult,richResultStatus,scheduledRichResult} from '../src/rich-result-collection-v3.39.0.js';
const target={date:'2026-10-04',venue:'京都',raceNo:12};
const header=['着順','枠','馬番','馬名','性齢','斤量','騎手','タイム','着差','コーナー 通過順位','推定上り','人気','単勝','馬体重'];
function html(last='33.3',name='馬A',no='1'){return '<table><tr>'+header.map(x=>'<th>'+x+'</th>').join('')+'</tr><tr>'+['1','1',no,name,'牡3','57','騎手','1:33.2','','4 3',last,'2','5.0','480(+2)'].map(x=>'<td>'+x+'</td>').join('')+'</tr></table>'}
async function database(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,runner_count INTEGER,surface TEXT,distance INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,source_kind TEXT,source_url TEXT,fetched_at TEXT,UNIQUE(race_key,horse_no));INSERT INTO jra_races VALUES('r','2026-10-04','京都',12,'任意レース',1,'芝',1600);INSERT INTO jra_runners VALUES('r',1,'馬A',3);INSERT INTO lab_race_outcomes VALUES('r',1,'馬A',1,'legacy','https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0108202602011220261004/AA','old');");const db={prepare(query){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(query).all(...args)}},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};await ensureResultDetailTables(db);return{sql,db}}
const stamp=Date.parse('2026-10-06T05:00:00Z');const response=x=>new Response(x,{headers:{'content-type':'text/html; charset=utf-8'}});

test('active result collector posts the published CNAME and accepts form endpoint response URL',async()=>{
 const {sql,db}=await database();const calls=[];
 const result=await collectRichResult(db,target,{now:()=>stamp,fetcher:async(url,options)=>{
 calls.push({url,options});const r=response(html());Object.defineProperty(r,'url',{value:url});return r;
 }});
 assert.equal(result.status,'collected');assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://www.jra.go.jp/JRADB/accessS.html');
 assert.equal(calls[0].options.method,'POST');
 assert.match(new URLSearchParams(calls[0].options.body).get('CNAME'),/^pw01sde/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_race_result_details').get().n,1);sql.close();
});
test('403 persists a failed result receipt, pauses shared source requests, and never writes result rows',async()=>{
 const {sql,db}=await database();let calls=0;
 const result=await collectRichResult(db,target,{now:()=>stamp,fetcher:async()=>{calls++;return new Response('',{status:403})}});
 assert.equal(result.status,'failed');assert.match(result.error,/HTTP 403/);
 assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,stamp+3600000);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_race_result_details').get().n,0);
 assert.equal((await collectRichResult(db,target,{now:()=>stamp+61000,fetcher:async()=>{calls++;throw Error('must not retry')}})).status,'receipt-cooldown');
 assert.equal(calls,1);sql.close();
});
test('result collector refuses a redirect to another JRA page even when HTML appears valid',async()=>{
 const {sql,db}=await database();
 const result=await collectRichResult(db,target,{now:()=>stamp,fetcher:async()=>{const r=response(html());Object.defineProperty(r,'url',{value:'https://www.jra.go.jp/other'});return r;}});
 assert.equal(result.ok,false);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_race_result_details').get().n,0);sql.close();
});
