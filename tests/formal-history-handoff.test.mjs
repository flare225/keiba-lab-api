import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectLiveHistory} from '../src/live-source-dispatch.js';
import {collectUpcomingOfficialHistory} from '../src/upcoming-official-history.js';
import {collectHistoryBatch,ensureCollectionTables} from '../src/history-collection-v3.37.0.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
const stamp=Date.parse('2026-11-06T16:00:00+09:00'),date='2026-11-07',key=date+':京都:11';
const profile='https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002021105521/7D';
async function fixture(){
 const sql=new DatabaseSync(':memory:');
 const db={prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return w()},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await ensureCollectionTables(db);await ensureHistoryTable(db);
 sql.exec('CREATE TABLE jra_races(race_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,source_url TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT)');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?)').run(key,date,'京都',11,'合成正式カード','https://www.jra.go.jp/card',1);
 sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(key,1,'HorseA',5);
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'京都',11,'15:40','https://www.jra.go.jp/program');
 sql.prepare('INSERT INTO lab_history_profile_links VALUES(?,?,?,?,?,?)').run(key,'HorseA',5,profile,'https://www.jra.go.jp/card',stamp);
 assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('lab_expected_roster_registry','lab_confirmed_predraw_rosters')").get().n,0);
 return{db,sql};
}
const html='<h1>HorseA</h1><table>'+['2026年10月3日','2026年9月1日','2026年8月1日'].map(d=>'<tr>'+[d,'京都','合成過去走','芝2400','良','18','2','1','騎手','57','480(+2)','2:24.1','111','勝馬'].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
test('a fresh formal-only card reaches real natural history storage before the next card, without a candidate registry',async()=>{
 const {db,sql}=await fixture();let requests=0;
 const result=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:{lane:'card',target:key,priorityFormalHistoryPending:true},
  cards:()=>assert.fail('fresh formal history must precede another card'),
  upcoming:(database,options)=>collectUpcomingOfficialHistory(database,{...options,collect:(d,input,deps)=>collectHistoryBatch(d,input,{...deps,wait:async()=>{},fetcher:async (url,options)=>{requests++;assert.equal(url,new URL(profile).origin+new URL(profile).pathname);assert.equal(options.method,'POST');assert.equal(new URLSearchParams(options.body).get('CNAME'),new URL(profile).searchParams.get('CNAME'));return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});}})})});
 assert.equal(result.historyWorkStage,'history');assert.equal(result.priorityRaceKey,key);assert.equal(result.addedRows,3,JSON.stringify(result));assert.equal(requests,1);assert.equal(result.cardSelection.priorityFormalHistoryPending,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM jra_past_performances').get().n,3);assert.equal(sql.prepare('SELECT status FROM lab_history_collection_receipts').get().status,'checked');sql.close();
});

test('formal-only handoff preserves source blocking cooldown and never falls through to another card',async()=>{
 for(const code of [403,429,503]){
  const {db,sql}=await fixture();let requests=0;
  const out=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:{lane:'card',target:key,priorityFormalHistoryPending:true},cards:()=>assert.fail('no fallback after attempted history'),upcoming:(database,options)=>collectUpcomingOfficialHistory(database,{...options,collect:(d,input,deps)=>collectHistoryBatch(d,input,{...deps,fetcher:async()=>{requests++;return new Response('',{status:code});}})})});
  assert.equal(out.historyWorkStage,'history');assert.equal(out.addedRows,0);assert.equal(out.attempted,1);assert.equal(requests,1);assert.equal(out.externalRequests,1);
  assert.equal(sql.prepare('SELECT count(*) n FROM jra_past_performances').get().n,0);
  assert.equal(sql.prepare("SELECT next_batch_at FROM lab_history_collection_budget WHERE name='jra-history'").get().next_batch_at,stamp+3600000);sql.close();
 }
});

test('remaining formal-only horses get their completion turn before unrelated calendar recovery after the one-shot flag clears',async()=>{
 const {db,sql}=await fixture();sql.prepare('UPDATE jra_races SET runner_count=2').run();sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run(key,2,'HorseB',5);
 sql.prepare('INSERT INTO lab_history_profile_links VALUES(?,?,?,?,?,?)').run(key,'HorseB',5,profile.replace('105521','105522'),'https://www.jra.go.jp/card',stamp);
 let requests=0,calendar=0,stampNow=stamp;
 const deps={now:()=>stampNow,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:{lane:'discovery',priorityFormalHistoryPending:false},
  cards:async()=>({ok:true,status:'card-discovery-not-due',externalRequests:0}),missing:async()=>({status:'source-not-due',externalRequests:0}),registered:async()=>[],
  programs:async()=>{calendar++;return{ok:false,status:'source-unconfirmed',date:'2026-11-06',error:'JRA program HTTP 403',externalRequests:1}},
  upcoming:(database,options)=>collectUpcomingOfficialHistory(database,{...options,collect:(d,input,ctx)=>collectHistoryBatch(d,input,{...ctx,wait:async()=>{},fetcher:async(u,o)=>{requests++;const name=new URLSearchParams(o.body).get('CNAME').includes('105522')?'HorseB':'HorseA';return new Response(html.replaceAll('HorseA',name),{headers:{'content-type':'text/html; charset=utf-8'}});}})})};
 for(let i=0;i<2;i++){const r=await collectLiveHistory(db,{scheduledTime:stampNow},deps);assert.equal(r.addedRows,3,JSON.stringify(r));assert.equal(r.historyWorkStage,'history');stampNow+=18*60000;}
 assert.equal(requests,2);assert.equal(calendar,0);assert.equal(sql.prepare('SELECT count(*) n FROM jra_past_performances').get().n,6);assert.equal(sql.prepare('SELECT count(DISTINCT horse_name) n FROM jra_past_performances').get().n,2);
 const next=await collectLiveHistory(db,{scheduledTime:stampNow},{...deps,previousHistoryWorkStage:'history'});assert.equal(next.status,'source-unconfirmed');assert.equal(calendar,1);assert.equal(requests,2);
 assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='lab_expected_roster_registry'").get().n,0);sql.close();
});

test('remaining formal-history turn keeps safety stops, one plan when idle, and quota propagation before calendar fallback',async()=>{
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 for(const status of ['cooldown','lease-unavailable','shared-gate-unavailable','paused','idle','quota']){
  let plans=0,calendars=0;
  const deps={now:()=>stamp,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:{priorityFormalHistoryPending:false},cards:async()=>({ok:true,status:'card-discovery-not-due',externalRequests:0}),registered:async()=>[],missing:async()=>null,
   upcoming:async()=>{plans++;if(status==='quota')throw Error('exceeded D1 daily row read limit');return status==='idle'?null:{status,externalRequests:0}},programs:async()=>{calendars++;return null},main:async()=>null,expected:async()=>({status:'idle',externalRequests:0}),details:async()=>({status:'idle',externalRequests:0})};
  if(status==='quota')await assert.rejects(collectLiveHistory(db,{scheduledTime:stamp},deps),/daily row read limit/);
  else{const r=await collectLiveHistory(db,{scheduledTime:stamp},deps);assert.equal(r.status,status);}
  assert.equal(plans,1);assert.equal(calendars,status==='idle'?1:0);
 }
});
