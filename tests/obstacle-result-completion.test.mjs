import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseOfficialResultDetails,ensureResultDetailTables} from '../src/result-detail-v3.39.0.js';
import {collectRichResult,richResultStatus,scheduledRichResult} from '../src/rich-result-collection-v3.39.0.js';
const date='2026-10-11',key=date+':京都:4',source='https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1008202604040420261011/14';
const headers=['着順','馬番','馬名','タイム','コーナー通過順位','平均1F'];
const html='<table><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr>'+['馬A','馬B'].map((name,i)=>'<tr>'+[i+1,i+1,name,'3:17.6','1 1 1 1',13.6+i/10].map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</table>';
async function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,runner_count INTEGER,surface TEXT,distance INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,horse_name TEXT,finish_position INTEGER,source_kind TEXT,source_url TEXT,fetched_at TEXT,UNIQUE(race_key,horse_no));');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?,?)').run(key,date,'京都',4,'障害3歳以上未勝利',2,'芝',2910);
 for(let i=1;i<=2;i++){sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(key,i,i===1?'馬A':'馬B',4);sql.prepare('INSERT INTO lab_race_outcomes VALUES(?,?,?,?,?,?,?)').run(key,i,i===1?'馬A':'馬B',i,'legacy',source,'old');}
 const db={prepare(q){const wrap=(a=[])=>({bind(...x){return wrap(x)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}});return wrap()},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 await ensureResultDetailTables(db);return{sql,db};
}
test('JRA obstacle average 1F never becomes a horse last3f value',()=>{
 const p=parseOfficialResultDetails(html,[{horse_no:1,horse_name:'馬A'},{horse_no:2,horse_name:'馬B'}]);
 assert.equal(p.ok,true);assert.equal(p.rows[0].average1f,13.6);assert.equal(p.rows[0].last3f,null);
});
test('obstacle completion requires real average1f storage and is idempotent without fabricated last3f',async()=>{
 const {sql,db}=await fixture();try{
 const r=await collectRichResult(db,{date,venue:'京都',raceNo:4},{now:()=>Date.parse('2026-10-14T01:00:00Z'),fetcher:async()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})});
 assert.equal(r.status,'collected');assert.equal(r.average1fRows,2);assert.equal(r.last3fRows,0);
 const status=await richResultStatus(db,date);assert.equal(status.richCompleteRaces,1);assert.equal(status.average1fMissing,0);
 assert.equal(status.details[0].last3fRequired,false);assert.equal(status.details[0].last3fComplete,null);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_race_result_details WHERE last3f IS NOT NULL').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_obstacle_average1f').get().n,2);
 const again=await collectRichResult(db,{date,venue:'京都',raceNo:4},{now:()=>Date.parse('2026-10-14T01:01:00Z'),fetcher:async()=>{throw Error('complete race must not fetch')}});
 assert.equal(again.status,'complete');assert.equal(again.externalRequests,0);
 sql.exec('DELETE FROM lab_obstacle_average1f');
 assert.equal((await richResultStatus(db,date)).richCompleteRaces,0);
 sql.exec("UPDATE lab_rich_collection_receipts SET policy_version='bounded-jra-result-v1'");
 const resumed=await scheduledRichResult(db,{now:()=>Date.parse('2026-10-14T01:02:00Z'),fetcher:async(url,options)=>{assert.equal(options.method,'POST');return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(resumed.status,'collected');assert.equal(resumed.average1fRows,2);
 }finally{sql.close()}
});
test('status before the additive storage table is initialized reports incomplete rather than a fake success',async()=>{
 const {sql,db}=await fixture();try{sql.exec('DROP TABLE lab_obstacle_average1f');const status=await richResultStatus(db,date);assert.equal(status.average1fStorageReady,false);assert.equal(status.richCompleteRaces,0);}finally{sql.close()}
});
