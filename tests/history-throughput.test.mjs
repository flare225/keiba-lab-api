import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {collectHistoryBatch,collectionStatus,collectionDue,officialUrl,scheduledCollection,ensureCollectionTables} from '../src/history-collection-v3.37.0.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
const target={date:'2026-10-04',venue:'京都',raceNo:11,historyLimit:10,batchSize:2};
const profile='https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002021105521/7D';
function row(date,name='過去レース'){return '<tr>'+[date,'京都',name,'芝2400','良','18','2','1','騎手','57','480(+2)','2:24.1','111','勝馬'].map(x=>'<td>'+x+'</td>').join('')+'</tr>'}
const history='<h1>HorseA HorseB</h1><table>'+row('2026年10月4日','当日')+row('2026年9月1日')+row('2025年9月1日')+row('2020年9月1日','別世代')+'</table>';
const card='<a href="'+profile+'">HorseA</a><a href="'+profile+'">HorseB</a>';
async function database(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,source_url TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);INSERT INTO jra_races VALUES('r','2026-10-04','京都',11,'試験','https://www.jra.go.jp/card',2);INSERT INTO jra_runners VALUES('r',1,'HorseA',5),('r',2,'HorseB',5);");const db={prepare(query){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(query).all(...args)}},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()},async batch(ss){return Promise.all(ss.map(s=>s.run()))}};await ensureHistoryTable(db);return{sql,db}}
const response=html=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
test('expired cards collect both horses via stored matching result source within three requests',async()=>{
 for(const mode of ['valid','wrong-race','wrong-age','missing-horse']){
  const {db,sql}=await database();
  const resultUrl='https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1008202604021120261004/15';
  sql.exec('CREATE TABLE lab_race_result_details(race_key TEXT,source_url TEXT)');
  sql.prepare('INSERT INTO lab_race_result_details VALUES(?,?)').run('r',mode==='wrong-race'?resultUrl.replace('20261004','20261003'):resultUrl);
  const names=mode==='missing-horse'?['HorseA']:['HorseA','HorseB'];
  const result='<table><tr><th>着順</th><th>馬番</th><th>馬名</th><th>性齢</th></tr>'+names.map((n,i)=>'<tr><td>'+(i+1)+'</td><td>'+(i+1)+'</td><td><a href="'+profile+'">'+n+'</a></td><td>牡'+(mode==='wrong-age'?4:5)+'</td></tr>').join('')+'</table>';
  const urls=[];const r=await collectHistoryBatch(db,target,{now:()=>Date.parse('2026-10-06T03:00:00Z'),wait:async()=>{},fetcher:async url=>{urls.push(url);return response(url.includes('accessS')?result:url.includes('accessU')?history:'掲載は終了しております');}});
  assert.ok(urls.length<=3,mode);
  assert.equal(r.addedRows,mode==='valid'?4:0,mode);
  assert.equal(urls.filter(u=>u.includes('accessU')).length,mode==='valid'?2:0,mode);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM jra_past_performances WHERE race_date>='2026-10-04'").get().n,0);
  if(mode==='valid')assert.deepEqual(urls,[resultUrl,profile,profile]);sql.close();
 }
});
test('cross-race fallback verifies provenance, cohort and unique profile before fetching',async()=>{
 for(const mode of ['valid','wrong-age','changed-source','conflicting','future','external-source']){
  const {db,sql}=await database();await ensureCollectionTables(db);
  sql.exec("INSERT INTO jra_races VALUES('prior','2025-09-01','京都',1,'前走','https://www.jra.go.jp/prior',1);INSERT INTO jra_runners VALUES('prior',1,'HorseA',4)");
  sql.prepare('INSERT INTO lab_history_profile_links VALUES(?,?,?,?,?,?)').run('prior','HorseA',4,profile,'https://www.jra.go.jp/prior',1);
  if(mode==='wrong-age')sql.exec("UPDATE lab_history_profile_links SET age=3");
  if(mode==='changed-source')sql.exec("UPDATE jra_races SET source_url='https://www.jra.go.jp/changed' WHERE race_key='prior'");
  if(mode==='future')sql.exec("UPDATE jra_races SET race_date='2026-10-05' WHERE race_key='prior';UPDATE jra_runners SET age=5 WHERE race_key='prior';UPDATE lab_history_profile_links SET age=5");
  if(mode==='external-source')sql.exec("UPDATE jra_races SET source_url='https://example.com/card' WHERE race_key='prior';UPDATE lab_history_profile_links SET source_url='https://example.com/card'");
  if(mode==='conflicting'){
   sql.exec("INSERT INTO jra_races SELECT 'other',race_date,venue,2,race_name,source_url,1 FROM jra_races WHERE race_key='prior';INSERT INTO jra_runners VALUES('other',1,'HorseA',4)");
   sql.prepare('INSERT INTO lab_history_profile_links VALUES(?,?,?,?,?,?)').run('other','HorseA',4,profile.replace('105521','105522'),'https://www.jra.go.jp/prior',2);
  }
  const urls=[];const r=await collectHistoryBatch(db,{...target,batchSize:1},{now:()=>Date.parse('2026-10-06T03:00:00Z'),wait:async()=>{},fetcher:async url=>{urls.push(url);return response(url.includes('accessU')?history:'<html>no links</html>');}});
  assert.equal(r.addedRows,mode==='valid'?2:0,mode);
  assert.equal(urls.filter(u=>u.includes('accessU')).length,mode==='valid'?1:0,mode);
  assert.equal(r.results[0].status,mode==='valid'?'checked':'failed',mode);sql.close();
 }
});
test('SQLite bounded batch excludes cutoff/cohort, preserves rich fields and resumes without refetch',async()=>{const {sql,db}=await database();sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,last3f,corner_positions,fetched_at) VALUES(?,?,?,?,?,?,?)').run('HorseA','2026-09-01','京都','過去レース',33.3,'2-2-1','old');let stamp=Date.parse('2026-10-06T03:00:00Z');const urls=[],gaps=[];const deps={now:()=>stamp,wait:async ms=>{gaps.push(ms);stamp+=ms},fetcher:async url=>{urls.push(url);return response(url.includes('accessU')?history:card)}};const result=await collectHistoryBatch(db,target,deps);assert.equal(result.externalRequests,3);assert.equal(result.attempted,2);assert.deepEqual(gaps,[5000,5000]);assert.equal(result.addedRows,3);const saved=sql.prepare("SELECT * FROM jra_past_performances WHERE horse_name='HorseA' AND race_date='2026-09-01'").get();assert.equal(saved.last3f,33.3);assert.equal(saved.corner_positions,'2-2-1');assert.equal(saved.odds,null);assert.equal(sql.prepare("SELECT COUNT(*) n FROM jra_past_performances WHERE race_date='2026-10-04' OR race_date='2020-09-01'").get().n,0);const again=await collectHistoryBatch(db,target,deps);assert.equal(again.status,'complete');assert.equal(urls.length,3);assert.equal((await collectionStatus(db,target,stamp)).last3fRows,1);sql.close()});
test('429 defers all collection for one hour and failed receipt stays pending',async()=>{const {sql,db}=await database();let stamp=Date.parse('2026-10-06T03:00:00Z');const deps={now:()=>stamp,wait:async()=>{},fetcher:async()=>new Response('',{status:429})};const first=await collectHistoryBatch(db,target,deps);assert.equal(first.externalRequests,1);assert.equal(first.after.remainingHorses,2);stamp+=61000;assert.equal((await collectHistoryBatch(db,target,deps)).status,'cooldown');assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,Date.parse('2026-10-06T04:00:00Z'));sql.close()});
test('unknown table cannot be accepted as zero history; 20-row batch clamps to one horse',async()=>{const {sql,db}=await database();const now=()=>Date.parse('2026-10-06T03:00:00Z');const result=await collectHistoryBatch(db,{...target,historyLimit:20},{now,wait:async()=>{},fetcher:async url=>response(url.includes('accessU')?'<h1>HorseA</h1>maintenance':card)});assert.equal(result.attempted,1);assert.equal(result.results[0].status,'failed');assert.match(result.results[0].error,/履歴ゼロ/);sql.close()});
test('scheduler collects two horses within the existing three-request budget',async()=>{const {sql,db}=await database();const result=await scheduledCollection(db,{now:()=>Date.parse('2026-10-06T03:00:00Z'),wait:async()=>{},fetcher:async url=>response(url.includes('accessU')?history:card)});assert.equal(result.attempted,2);assert.equal(result.externalRequests,3);assert.equal(sql.prepare('SELECT status FROM lab_history_collection_targets').get().status,'complete');sql.close()});
test('archive receipts are stable, future refresh is daily, external URLs rejected',()=>{const rec={policy_version:'bounded-jra-profile-v1',requested_limit:10,status:'checked',checked_at:Date.parse('2026-10-05T00:00:00Z')};assert.equal(collectionDue(rec,'2026-10-04',10,Date.parse('2026-10-06T00:00:00Z')),false);assert.equal(collectionDue(rec,'2026-10-10',10,Date.parse('2026-10-06T00:00:00Z')),true);assert.equal(collectionDue(rec,'2026-10-04',20,Date.parse('2026-10-06T00:00:00Z')),true);assert.throws(()=>officialUrl('https://example.com/JRADB/accessU.html'));assert.throws(()=>officialUrl('https://www.jra.go.jp/card',true));});
import {historyCollectionPage} from '../src/history-collection-page-v3.32.0.js';
test('collection screen script compiles and states missing last3f',()=>{const html=historyCollectionPage('2026-10-06');for(const [,s] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(s);assert.ok(html.includes('10年分の全レース収集はまだ完了していません'));assert.ok(html.includes('上がりを消しません'));});
test('global lease prevents overlapping external fetches',async()=>{const {sql,db}=await database();const stamp=Date.parse('2026-10-06T03:00:00Z');await collectHistoryBatch(db,target,{now:()=>stamp,wait:async()=>{},fetcher:async()=>new Response('',{status:429})});sql.prepare("UPDATE lab_history_collection_budget SET locked_until=?,next_batch_at=0").run(stamp+120000);let calls=0;const r=await collectHistoryBatch(db,target,{now:()=>stamp,fetcher:async()=>{calls++;return response(history)}});assert.equal(r.status,'cooldown');assert.equal(calls,0);sql.close()});

test('published profile links are reused on later batches without fetching the same card again',async()=>{const {sql,db}=await database();let stamp=Date.parse('2026-10-06T03:00:00Z');const urls=[];const deps={now:()=>stamp,wait:async ms=>{stamp+=ms},fetcher:async url=>{urls.push(url);return response(url.includes('accessU')?history:card)}};const first=await collectHistoryBatch(db,{...target,batchSize:1},deps);assert.equal(first.externalRequests,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_history_profile_links').get().n,2);stamp+=61000;const second=await collectHistoryBatch(db,{...target,batchSize:1},deps);assert.equal(second.externalRequests,1);assert.equal(urls.filter(x=>x.endsWith('/card')).length,1);sql.close()});
test('cached profile URL is rejected if horse age or current card source differs',async()=>{const {sql,db}=await database();let stamp=Date.parse('2026-10-06T03:00:00Z');const urls=[];const deps={now:()=>stamp,wait:async ms=>{stamp+=ms},fetcher:async url=>{urls.push(url);return response(url.includes('accessU')?history:card)}};await collectHistoryBatch(db,{...target,batchSize:1},deps);sql.exec("UPDATE lab_history_profile_links SET age=20 WHERE horse_name='HorseB'");stamp+=61000;const next=await collectHistoryBatch(db,{...target,batchSize:1},deps);assert.equal(next.externalRequests,2);assert.equal(urls.filter(x=>x.endsWith('/card')).length,2);sql.close()});
test('learning history gaps take priority over ordinary past race expansion',async()=>{const {sql,db}=await database();sql.exec("CREATE TABLE lab_learning_collection_receipts(experiment_id TEXT,race_key TEXT,status TEXT,missing_history_json TEXT);INSERT INTO lab_learning_collection_receipts VALUES('safe-core-shadow-20261010-v1','gap','awaiting-prior-history','[\"HorseC\"]');INSERT INTO jra_races VALUES('gap','2026-10-04','京都',1,'学習補完','https://www.jra.go.jp/card',1);INSERT INTO jra_runners VALUES('gap',1,'HorseC',5)");const result=await scheduledCollection(db,{now:()=>Date.parse('2026-10-06T03:00:00Z'),wait:async()=>{},fetcher:async url=>response(url.includes('accessU')?history.replaceAll('HorseA','HorseC'):'<a href="'+profile+'">HorseC</a>')});assert.equal(result.before.race.raceKey,'gap');assert.equal(result.attempted,1);sql.close()});

test('past debut races remain queued but cannot precede actionable training history',async()=>{
 const {sql,db}=await database();
 sql.exec("CREATE TABLE lab_learning_collection_receipts(experiment_id TEXT,race_key TEXT,status TEXT,missing_history_json TEXT);INSERT INTO lab_learning_collection_receipts VALUES('safe-core-shadow-20261010-v1','debut','awaiting-prior-history','[\"DebutHorse\"]');INSERT INTO jra_races VALUES('debut','2026-10-04','京都',5,'メイクデビュー京都','https://www.jra.go.jp/card',1);INSERT INTO jra_runners VALUES('debut',1,'DebutHorse',2)");
 const result=await scheduledCollection(db,{now:()=>Date.parse('2026-10-06T03:00:00Z'),wait:async()=>{},fetcher:async url=>response(url.includes('accessU')?history:card)});
 assert.equal(result.before.race.raceKey,'r');
 assert.equal(sql.prepare("SELECT status FROM lab_history_collection_targets WHERE race_key='debut'").get().status,'pending');sql.close();
});

test('untried runners advance before repeating a failed lower-numbered runner',async()=>{
 const {sql,db}=await database();let stamp=Date.parse('2026-10-06T03:00:00Z');const deps={now:()=>stamp,wait:async()=>{},fetcher:async url=>response(url.includes('accessU')?history:'<a href="'+profile+'">HorseB</a>')};
 const first=await collectHistoryBatch(db,{...target,batchSize:1},deps);assert.equal(first.results[0].horseName,'HorseA');assert.equal(first.results[0].status,'failed');stamp+=3600001;const second=await collectHistoryBatch(db,{...target,batchSize:1},deps);assert.equal(second.results[0].horseName,'HorseB');assert.equal(second.results[0].status,'checked');sql.close();
});
test('race with all failed runners awaiting retry cannot block a different pending race',async()=>{
 const {sql,db}=await database();let stamp=Date.parse('2026-10-06T03:00:00Z');const deps={now:()=>stamp,wait:async()=>{},fetcher:async()=>response('<html>No published links</html>')};await collectHistoryBatch(db,target,deps);stamp+=61000;
 sql.exec("INSERT INTO jra_races VALUES('next','2026-10-04','京都',10,'次の対象','https://www.jra.go.jp/card',1);INSERT INTO jra_runners VALUES('next',1,'HorseC',5)");
 const result=await scheduledCollection(db,{...deps,fetcher:async url=>response(url.includes('accessU')?history.replaceAll('HorseA','HorseC'):'<a href="'+profile+'">HorseC</a>')});assert.equal(result.before.race.raceKey,'next');assert.equal(result.results[0].status,'checked');sql.close();
});
