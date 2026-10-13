import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {collectHistoryBatch,collectionStatus,collectionDue,officialUrl,scheduledCollection} from '../src/history-collection-v3.37.0.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
const target={date:'2026-10-04',venue:'京都',raceNo:11,historyLimit:10,batchSize:2};
const profile='https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002021105521/7D';
function row(date,name='過去レース'){return '<tr>'+[date,'京都',name,'芝2400','良','18','2','1','騎手','57','480(+2)','2:24.1','111','勝馬'].map(x=>'<td>'+x+'</td>').join('')+'</tr>'}
const history='<h1>HorseA HorseB</h1><table>'+row('2026年10月4日','当日')+row('2026年9月1日')+row('2025年9月1日')+row('2020年9月1日','別世代')+'</table>';
const card='<a href="'+profile+'">HorseA</a><a href="'+profile+'">HorseB</a>';
async function database(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,source_url TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);INSERT INTO jra_races VALUES('r','2026-10-04','京都',11,'試験','https://www.jra.go.jp/card',2);INSERT INTO jra_runners VALUES('r',1,'HorseA',5),('r',2,'HorseB',5);");const db={prepare(query){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(query).all(...args)}},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()},async batch(ss){return Promise.all(ss.map(s=>s.run()))}};await ensureHistoryTable(db);return{sql,db}}
const response=html=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});

test('active history collector uses one profile form and breaks the batch on 403',async()=>{
 const {sql,db}=await database();let calls=[];
 const stamp=Date.parse('2026-10-13T03:00:00Z');
 const result=await collectHistoryBatch(db,target,{now:()=>stamp,wait:async()=>{},fetcher:async(url,options)=>{
 calls.push({url,options});return url.includes('accessU')?new Response('',{status:403}):response(card);
 }});
 assert.equal(result.results[0].status,'failed');assert.equal(result.attempted,1);
 assert.equal(calls.length,2);assert.equal(calls[1].options.method,'POST');
 assert.equal(calls[1].url,'https://www.jra.go.jp/JRADB/accessU.html');
 assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,stamp+3600000);
 assert.match(result.after.runners[0].collectionError,/HTTP 403/);
 assert.equal(result.after.runners[0].nextRetryAt,new Date(stamp+3600000).toISOString());
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_past_performances').get().n,0);sql.close();
});
