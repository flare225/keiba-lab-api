import test from 'node:test';import assert from 'node:assert/strict';
import {storedCardPriorCells} from '../src/stored-card-prior-cells.js';
const url='https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002023100001/A1';
const row=(name,id,date)=>`<tr><td class="horse"><div class="name_line"><div class="name"><a href="${id}">${name}</a></div></div></td><td class="past p1"><div class="date">${date}</div><div class="name">別レース名</div></td></tr>`;
test('stored card cells retain horse identity and exclude target/future dates and siblings',()=>{
 const input={horseName:'対象馬',profileUrl:url,beforeDate:'2026-10-31'};
 const html=row('隣馬',url,'2026年10月1日')+row('対象馬',url,'2026年10月2日')+row('対象馬',url,'2026年10月31日');
 const found=storedCardPriorCells(html,input);assert.equal(found.length,1);assert.equal(found[0].raceDate,'2026-10-02');assert.equal(found[0].horseName,'対象馬');
 assert.throws(()=>storedCardPriorCells(row('対象馬',url.replace('100001','100002'),'2026年10月2日'),input),/identity/);
});
import {decodeStoredCardPriors,readStoredCardPriors} from '../src/stored-card-prior-cells.js';
import {createHash} from 'node:crypto';
const cell='<div class="date">2026年10月2日</div><div class="rc">東京</div><div class="name"><a href="/result">1勝クラス</a></div><div class="place">2<span>着</span></div><span class="max">16<span>頭</span></span><span class="dist">2100ダ</span><div class="jockey">騎手</div><div class="weight">56.0<span>kg</span></div><p class="h_weight">480<span>kg</span></p><p class="time">2:12.5</p><span class="condition">良</span><div class="f3">3F 37.5</div>';
test('observed nested card cells decode race name, valid finish and rich fields',()=>{const [p]=decodeStoredCardPriors([{horseName:'対象馬',raceDate:'2026-10-02',cellHtml:cell}],url);assert.equal(p.raceName,'1勝クラス');assert.equal(p.finishPosition,2);assert.equal(p.distance,2100);assert.equal(p.last3f,37.5);assert.equal(p.assignedWeight,56);assert.equal(p.bodyWeight,480);assert.equal(decodeStoredCardPriors([{horseName:'対象馬',raceDate:'2026-10-02',cellHtml:cell.replace('2<span>着','取消<span>着')}],url).length,0);});
test('stored source hash is verified and insufficient card history falls back',async()=>{let html=row('対象馬',url,'2026年10月2日').replace('<div class="date">2026年10月2日</div>',cell);const source={body_html:html,byte_length:Buffer.byteLength(html),source_sha256:createHash('sha256').update(html).digest('hex')};const db={prepare(){return{bind(){return{async first(){return source}}}}}};const context={race:{source_url:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604100620261031/FD',race_key:'2026-10-31:東京:6',race_date:'2026-10-31'}};const item={horseName:'対象馬',fromDate:'2025-01-01'};assert.equal((await readStoredCardPriors(db,context,item,1)).performances.length,1);assert.equal(await readStoredCardPriors(db,context,item,3),null);source.source_sha256='bad';await assert.rejects(readStoredCardPriors(db,context,item,1),/hash mismatch/);});
import {DatabaseSync} from 'node:sqlite';
import {collectHistoryBatch} from '../src/history-collection-v3.37.0.js';
import {saveConfirmedPredraw} from '../src/confirmed-predraw-roster.js';
import {collectUpcomingExpectedHistory,expectedHistoryContext} from '../src/expected-history-collection-v3.46.0.js';
test('natural collector reuses evidence-bound body, saves rows, reads back and obeys cooldown without HTTP',async()=>{
 const sql=new DatabaseSync(':memory:');
 const sourceUrl='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604100620261031/FD';
 const html=row('対象馬',url,'2026年10月2日').replace('<div class="date">2026年10月2日</div>',cell+'</td><td class="past p2">'+cell.replaceAll('10月2日','9月2日')+'</td><td class="past p3">'+cell.replaceAll('10月2日','8月2日'));
 const hash=createHash('sha256').update(html).digest('hex');
 sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,source_url TEXT,runner_count INTEGER,fetched_at TEXT);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,age INTEGER);CREATE TABLE lab_card_source_evidence(race_key TEXT,source_url TEXT,source_sha256 TEXT,card_fetched_at TEXT,horse_numbers_observed INTEGER,frames_observed INTEGER,declared_count INTEGER,parsed_count INTEGER);CREATE TABLE lab_shared_page_bodies_v1(scope_key TEXT,page_url TEXT,sha256 TEXT,body_html TEXT,byte_length INTEGER);');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?,?,?)').run('r','2026-10-31','東京',6,'試験',sourceUrl,1,'saved');sql.prepare('INSERT INTO jra_runners VALUES(?,?,?,?)').run('r',1,'対象馬',3);sql.prepare('INSERT INTO lab_card_source_evidence VALUES(?,?,?,?,1,1,1,1)').run('r',sourceUrl,hash,'saved');sql.prepare('INSERT INTO lab_shared_page_bodies_v1 VALUES(?,?,?,?,?)').run('2026-10-31',sourceUrl,hash,html,Buffer.byteLength(html));
 const db={prepare(q){const wrap=(a=[])=>({bind(...v){return wrap(v)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}});return wrap()},async batch(ss){return Promise.all(ss.map(s=>s.run()))}};
 const input={date:'2026-10-31',venue:'東京',raceNo:6,historyLimit:3,batchSize:1},now=()=>Date.parse('2026-10-30T06:00:00Z'),fetcher=()=>assert.fail('stored body must not fetch');
 const r=await collectHistoryBatch(db,input,{now,fetcher});assert.equal(r.externalRequests,0);assert.equal(r.addedRows,3);assert.equal(r.results[0].reusedStoredCard,true);assert.equal(r.after.totalStoredRows,3);assert.equal(sql.prepare('SELECT finish_position FROM jra_past_performances').get().finish_position,2);
 assert.equal((await collectHistoryBatch(db,input,{now,fetcher})).attempted,0);
 sql.prepare('UPDATE jra_past_performances SET last3f=33.1,corner_positions=\'1-1\' WHERE race_date=\'2026-10-02\'').run();sql.prepare('DELETE FROM jra_past_performances WHERE race_date<>\'2026-10-02\'').run();sql.prepare('DELETE FROM lab_history_collection_receipts').run();sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();const resumed=await collectHistoryBatch(db,input,{now,fetcher});assert.equal(resumed.addedRows,2);assert.equal(resumed.externalRequests,0);const rich=sql.prepare('SELECT last3f,corner_positions FROM jra_past_performances WHERE race_date=\'2026-10-02\'').get();assert.equal(rich.last3f,33.1);assert.equal(rich.corner_positions,'1-1');
 sql.prepare('DELETE FROM lab_history_collection_receipts').run();sql.prepare('DELETE FROM jra_past_performances').run();sql.prepare('UPDATE lab_history_collection_budget SET locked_until=?').run(now()+3600000);assert.equal((await collectHistoryBatch(db,input,{now,fetcher})).status,'cooldown');assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_past_performances').get().n,0);sql.close();
});

async function predrawFixture(count=3,names=['対象馬']){
 const sql=new DatabaseSync(':memory:');
 const db={prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}});return w()},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const source={date:'2026-11-07',venue:'京都',raceNo:11,snapshotId:'confirmed-predraw:2026-11-07:京都:11',names,priority:50};
 const sourceUrl='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202605011120261107%2F13';
 const priors=Array.from({length:count},(_,i)=>'<td class="past p'+(i+1)+'">'+cell.replaceAll('10月2日',(10-i)+'月2日')+'</td>').join('');
 const html='<table><caption>2026年11月7日 京都<img alt="11レース"></caption><thead></thead><tbody>'+names.map((name,i)=>'<tr><td class="waku"></td><td class="num"></td><td class="horse"><div class="name_line"><div class="name"><a href="'+url.replace('100001',String(100001+i))+'">'+name+'</a></div></div></td><td class="jockey"><p class="age">牡3/鹿</p><p class="weight">56.0</p><p class="jockey">騎手</p></td>'+(Array.isArray(count)?Array.from({length:count[i]},(_,j)=>'<td class="past p'+(j+1)+'">'+cell.replaceAll('10月2日',(10-j)+'月2日')+'</td>').join(''):priors)+'</tr>').join('')+'</tbody></table>';
 const now=()=>Date.parse('2026-11-05T09:42:52.196Z'),hash=await sha256(html);
 await saveConfirmedPredraw(db,html,sourceUrl,source,{observedAt:new Date(now()).toISOString()});
 sql.exec('CREATE TABLE lab_shared_page_bodies_v1(scope_key TEXT,page_url TEXT,sha256 TEXT,body_html TEXT,byte_length INTEGER,observed_at INTEGER,http_status INTEGER);CREATE TABLE lab_provisional_queue_v1(race_key TEXT,status TEXT,next_at INTEGER,error TEXT)');
 sql.prepare('INSERT INTO lab_shared_page_bodies_v1 VALUES(?,?,?,?,?,?,?)').run(source.date,sourceUrl,hash,html,Buffer.byteLength(html),now(),200);
 sql.prepare('INSERT INTO lab_provisional_queue_v1 VALUES(?,?,?,?)').run('2026-11-07:京都:11','verified',now()+3600000,null);
 return{sql,db,source,sourceUrl,now,hash};
}
import {sha256} from '../src/card-evidence.js';
test('saved confirmed-predraw body feeds the real history writer and reevaluation queue without HTTP or a formal card',async()=>{
 const {sql,db,source,now,hash}=await predrawFixture();
 const result=await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('verified stored pre-draw priors must not fetch')});
 assert.equal(result.addedRows,3,JSON.stringify(result));assert.equal(result.externalRequests,0);assert.equal(result.results[0].sourceSha256,hash);assert.equal(result.provisionalEvaluationQueued,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_past_performances').get().n,3);
 assert.equal(sql.prepare('SELECT status FROM lab_provisional_queue_v1').get().status,'history-updated');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('jra_races','jra_runners')").get().n,0);
 assert.equal((await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('do not refetch successful history')})).externalRequests,0);sql.close();
});

test('pre-draw reuse rejects changed evidence, observations and identities rather than trusting context alone',async()=>{
 for(const change of ['body','roster','age','observation','scope','url-spelling']){
  const {sql,db,source,now,hash}=await predrawFixture();const context=await expectedHistoryContext(db,source,now());
  const item={horseName:'対象馬',age:3,fromDate:'2025-01-01'};
  if(change==='body')sql.prepare("UPDATE lab_shared_page_bodies_v1 SET body_html=body_html||'tampered'").run();
  if(change==='roster')sql.prepare("UPDATE lab_confirmed_predraw_rosters SET runners_json=replace(runners_json,'対象馬','隣馬')").run();
  if(change==='age')item.age=4;
  if(change==='observation')sql.prepare('UPDATE lab_shared_page_bodies_v1 SET observed_at=observed_at+1').run();
  if(change==='scope')sql.prepare("UPDATE lab_shared_page_bodies_v1 SET scope_key='2026-11-08'").run();
  if(change==='url-spelling')sql.prepare("UPDATE lab_shared_page_bodies_v1 SET page_url=replace(page_url,'%2F','/')").run();
  if(['body','roster','age','observation'].includes(change))await assert.rejects(readStoredCardPriors(db,context,item,3),/mismatch/);
  else{const result=await readStoredCardPriors(db,context,item,3);assert.equal(result?.sourceSha256??null,change==='scope'?null:hash);}
  sql.close();
 }
});

test('short pre-draw history keeps profile fallback and shared cooldown prevents even cached imports',async()=>{
 const {sql,db,source,now}=await predrawFixture(2),context=await expectedHistoryContext(db,source,now());
 const result=await readStoredCardPriors(db,context,{horseName:'対象馬',age:3,fromDate:'2025-01-01'},3,{includeProfileLink:true});
 assert.equal(result.performances,null);assert.equal(result.profileUrl,url);
 const {ensureCollectionTables}=await import('../src/history-collection-v3.37.0.js');await ensureCollectionTables(db);
 sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=? WHERE name='jra-history'").run(now()+3600000);
 const blocked=await collectHistoryBatch(db,{historyLimit:3,batchSize:1},{now,context,fetcher:()=>assert.fail('cooldown forbids network')});
 assert.equal(blocked.status,'cooldown');assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_past_performances').get().n,0);sql.close();
});


test('natural pre-draw completion saves at most two verified cached horses without HTTP and wakes first evaluation',async()=>{
 const {sql,db,source,now,hash}=await predrawFixture(3,['対象馬','隣馬','三頭目']);
 sql.prepare("UPDATE lab_provisional_queue_v1 SET status='awaiting-data'").run();
 const out=await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('cached expansion must never fetch')});
 assert.equal(out.attempted,2);assert.equal(out.addedRows,6);assert.equal(out.externalRequests,0);assert.equal(out.after.pendingHorses,1);
 assert.deepEqual(out.results.map(x=>[x.horseName,x.reusedStoredCard,x.sourceSha256]),[['対象馬',true,hash],['隣馬',true,hash]]);
 assert.equal(out.provisionalEvaluationQueued,1);assert.equal(sql.prepare('SELECT status,next_at FROM lab_provisional_queue_v1').get().status,'awaiting-data');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM jra_past_performances WHERE horse_name='三頭目'").get().n,0);
 sql.close();
});

test('cached expansion never fetches short second history; external first horse keeps original one-horse bound',async()=>{
 for(const counts of [[3,2],[2,3]]){
  const {sql,db,source,now}=await predrawFixture(counts,['対象馬','隣馬']);let calls=0;
  const context=await expectedHistoryContext(db,source,now());
  const out=await collectHistoryBatch(db,{historyLimit:3,batchSize:1,storedBatchSize:2},{now,context,fetcher:async()=>{calls++;return new Response('',{status:403});}});
  assert.equal(out.attempted,1);assert.equal(out.externalRequests,counts[0]===3?0:1);assert.equal(calls,out.externalRequests);
  assert.equal(out.addedRows,counts[0]===3?3:0);assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_history_collection_receipts WHERE horse_name='隣馬'").get().n,0);sql.close();
 }
});

test('stored expansion remains opt-in and cannot import during shared lease or cooldown',async()=>{
 for(const mode of ['default','lease','cooldown']){
  const {sql,db,source,now}=await predrawFixture(3,['対象馬','隣馬']);const context=await expectedHistoryContext(db,source,now());
  const {ensureCollectionTables}=await import('../src/history-collection-v3.37.0.js');await ensureCollectionTables(db);
  if(mode!=='default')sql.prepare('UPDATE lab_history_collection_budget SET '+(mode==='lease'?'locked_until':'next_batch_at')+'=?').run(now()+3600000);
  const out=await collectHistoryBatch(db,{historyLimit:3,batchSize:1,...(mode==='default'?{}:{storedBatchSize:2})},{now,context,fetcher:()=>assert.fail('no HTTP')});
  assert.equal(out.attempted,mode==='default'?1:0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_past_performances').get().n,mode==='default'?3:0);sql.close();
 }
});


test('explicit same-horse career total admits complete one/two-start cached histories; partial evidence still falls back',async()=>{
 for(const [starts,count,accepted] of [[1,1,true],[2,2,true],[3,2,false],[0,1,false],[2,1,false]]){
  const {sql,db,source,now}=await predrawFixture(count);let body=sql.prepare('SELECT body_html FROM lab_shared_page_bodies_v1').get().body_html;
  body=body.replace('</div></div></td>','</div></div><div class="result_line"><div class="cell result">(0.0.0.'+starts+')</div></div></td>');
  const hash=await sha256(body);
  sql.prepare('UPDATE lab_shared_page_bodies_v1 SET body_html=?,byte_length=?,sha256=?').run(body,Buffer.byteLength(body),hash);
  sql.prepare('UPDATE lab_confirmed_predraw_rosters SET source_sha256=?').run(hash);
  const context=await expectedHistoryContext(db,source,now());
  const out=await readStoredCardPriors(db,context,{horseName:'対象馬',age:3,fromDate:'2025-01-01'},3,{includeProfileLink:true});
  assert.equal(!!out.performances,accepted);
  if(accepted){
   assert.equal(out.coverageBasis,'observed-short-career-record');
   const result=await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('complete observed short career needs no HTTP')});
   assert.equal(result.externalRequests,0);assert.equal(result.addedRows,count);assert.equal(result.after.pendingHorses,0);
   assert.equal(sql.prepare('SELECT finish_position,last3f FROM jra_past_performances').get().finish_position,2);
  }sql.close();
 }
});


test('short-career proof rejects invalid finish, future prior, duplicate prior and conflicting totals',async()=>{
 for(const change of ['finish','future','duplicate','totals']){
  const {sql,db,source,now}=await predrawFixture(1);let body=sql.prepare('SELECT body_html FROM lab_shared_page_bodies_v1').get().body_html;
  const record='<div class="cell result">(0.0.0.1)</div>';
  body=body.replace('</div></div></td>','</div></div>'+record+(change==='totals'?record:'')+'</td>');
  if(change==='finish')body=body.replace('2<span>着','取消<span>着');
  if(change==='future')body=body.replace('2026年10月2日','2026年11月7日');
  if(change==='duplicate')body=body.replace('</tr>','<td class="past p2">'+cell+'</td></tr>');
  const hash=await sha256(body);sql.prepare('UPDATE lab_shared_page_bodies_v1 SET body_html=?,byte_length=?,sha256=?').run(body,Buffer.byteLength(body),hash);sql.prepare('UPDATE lab_confirmed_predraw_rosters SET source_sha256=?').run(hash);
  const context=await expectedHistoryContext(db,source,now());const result=await readStoredCardPriors(db,context,{horseName:'対象馬',age:3,fromDate:'2025-01-01'},3,{includeProfileLink:true});
  assert.equal(result.performances,null,change);sql.close();
 }
});


test('verified cached priors fill only null last3f in existing rows without HTTP or overwriting evidence',async()=>{
 const {sql,db,source,now,hash}=await predrawFixture();
 const first=await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('cache only')});
 assert.equal(first.addedRows,3);
 sql.prepare("UPDATE jra_past_performances SET last3f=NULL,finish_position=7,corner_positions='1-1',source_url='original' WHERE race_date='2026-10-02'").run();
 sql.prepare("UPDATE jra_past_performances SET last3f=33.1 WHERE race_date='2026-09-02'").run();
 sql.prepare('DELETE FROM lab_history_collection_receipts').run();
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const result=await collectUpcomingExpectedHistory(db,{sources:[source],now,verifyStoredCoverage:true,knownProfilesOnly:true,fetcher:()=>assert.fail('cache only')});
 assert.equal(result.addedRows,0);assert.equal(result.externalRequests,0);assert.equal(result.results[0].sourceSha256,hash);
 const fixed=sql.prepare("SELECT last3f,finish_position,corner_positions,source_url FROM jra_past_performances WHERE race_date='2026-10-02'").get();
 assert.equal(fixed.last3f,37.5);assert.equal(result.addedLast3fRows,1);assert.equal(fixed.finish_position,7);assert.equal(fixed.corner_positions,'1-1');assert.equal(fixed.source_url,source.sourceUrl??(await expectedHistoryContext(db,source,now())).race.source_url);
 assert.equal(sql.prepare("SELECT last3f FROM jra_past_performances WHERE race_date='2026-09-02'").get().last3f,33.1);
 assert.equal((await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('no repeat')})).attempted,undefined);
 sql.close();
});


test('focused checked histories repair cached null 3F once without resetting receipts or fetching',async()=>{
 const {sql,db,source,now}=await predrawFixture();
 await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('cache only')});
 sql.prepare("UPDATE jra_past_performances SET last3f=NULL WHERE race_date='2026-10-02'").run();
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const out=await collectUpcomingExpectedHistory(db,{sources:[source],now,verifyStoredCoverage:true,knownProfilesOnly:true,fetcher:()=>assert.fail('checked cache repair cannot fetch')});
 assert.equal(sql.prepare("SELECT last3f FROM jra_past_performances WHERE race_date='2026-10-02'").get().last3f,37.5);
 assert.equal(out.addedLast3fRows,1);assert.equal(out.addedRows,0);assert.equal(out.results[0].cachedRepairOnly,true);assert.equal(out.externalRequests,0);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const again=await collectUpcomingExpectedHistory(db,{sources:[source],now,verifyStoredCoverage:true,knownProfilesOnly:true,fetcher:()=>assert.fail('no repeat')});
 assert.equal(again.externalRequests,0);assert.equal(again.attempted,undefined);sql.close();
});

test('checked cached repair respects shared lease and unavailable source never falls back to HTTP or loops',async()=>{
 const {sql,db,source,now}=await predrawFixture();
 await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('cache only')});
 sql.prepare('UPDATE jra_past_performances SET last3f=NULL').run();
 sql.prepare('UPDATE lab_history_collection_budget SET locked_until=?').run(now()+3600000);
 const deps={sources:[source],now,verifyStoredCoverage:true,knownProfilesOnly:true,fetcher:()=>assert.fail('no HTTP fallback')};
 assert.equal((await collectUpcomingExpectedHistory(db,deps)).status,'cooldown');
 sql.prepare('UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=0').run();
 sql.prepare('DELETE FROM lab_shared_page_bodies_v1').run();
 const out=await collectUpcomingExpectedHistory(db,deps);assert.equal(out.externalRequests,0);assert.equal(out.results[0].status,'cached-last3f-unavailable');assert.equal(out.results[0].savedRows,0);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const again=await collectUpcomingExpectedHistory(db,deps);assert.equal(again.externalRequests,0);assert.equal(again.attempted,undefined);assert.equal(sql.prepare('SELECT SUM(last3f) n FROM jra_past_performances').get().n,null);sql.close();
});


test('corrupt cached repair preserves the successful receipt and cannot become an HTTP retry',async()=>{
 const {sql,db,source,now}=await predrawFixture();
 await collectUpcomingExpectedHistory(db,{sources:[source],now,knownProfilesOnly:true,fetcher:()=>assert.fail('cache only')});
 sql.prepare('UPDATE jra_past_performances SET last3f=NULL').run();
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 sql.prepare("UPDATE lab_shared_page_bodies_v1 SET body_html=body_html||'corrupt'").run();
 const deps={sources:[source],now,verifyStoredCoverage:true,knownProfilesOnly:true,fetcher:()=>assert.fail('no HTTP fallback')};
 const out=await collectUpcomingExpectedHistory(db,deps);assert.equal(out.ok,false);assert.equal(out.externalRequests,0);assert.match(out.results[0].error,/hash mismatch/);assert.equal(out.after.runners[0].verifiedForTarget,true);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const again=await collectUpcomingExpectedHistory(db,{...deps,now:()=>now()+86400001});assert.equal(again.externalRequests,0);assert.equal(again.attempted,undefined);assert.equal(sql.prepare('SELECT SUM(last3f) n FROM jra_past_performances').get().n,null);sql.close();
});
