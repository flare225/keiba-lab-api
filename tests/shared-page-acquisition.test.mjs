import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {discoverSharedSelectedCard,createSharedSelectedCardDiscoverer,canonicalPublishedPage,parseSharedPage,runSharedPageStep,planSharedPages,SHARED_PAGE_POLICY} from '../src/shared-page-acquisition.js';
import {sha256,runnerFingerprint,requireLockEvidence} from '../src/card-evidence.js';
import {runWithScheduledReadBudget} from '../src/scheduled-read-budget.js';
import {collectLiveHistory} from '../src/live-source-dispatch.js';
import {collectMissingOfficialCard} from '../src/missing-official-cards.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {scheduledAutomaticPrediction,readAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {fixtureDatabase,racesFixture,pageGraph,fixtureFetcher,FIXTURE_STAMP,SCOPE,INDEX,cardUrl,drawnHtml,calendar,meetingUrl} from './helpers/shared-page-fixture.mjs';
const input=races=>({scope:SCOPE,races});
const rows=sql=>sql.prepare('SELECT * FROM lab_shared_page_receipts_v1').all();
test('only saved literal official links are accepted; witnessed calendar excerpt yields index, not race success',async()=>{
 const html=await readFile(new URL('./fixtures/jra-calendar-index-link-20261023.html',import.meta.url),'utf8');const p=parseSharedPage(html,calendar('2026-10-24'));assert.deepEqual(p.pages,[INDEX]);assert.equal(p.cards.length,0);
 for(const url of ['https://attacker.invalid/JRADB/accessD.html?CNAME=pw01dli00/F3','https://user@www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3','https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud00/AA'])assert.throws(()=>canonicalPublishedPage(url));
 assert.equal(canonicalPublishedPage(INDEX.replace('%2F','/')),INDEX);
 const evidence=JSON.parse(await readFile(new URL('./fixtures/jra-meeting-links-20261024.json',import.meta.url),'utf8'));
 const findings=parseSharedPage(evidence.links.map(u=>`<a href="${u}">recorded URL</a>`).join(''),INDEX);
 const {metaFromMeetingListUrl}=await import('../src/index-v1.1.4.js');
 for(const venue of ['東京','京都','新潟']){
  const r=racesFixture().find(r=>r.date==='2026-10-24'&&r.venue===venue&&r.raceNo===12),race={...r,rootUrl:INDEX,start:Date.parse(r.startAt),enqueued:FIXTURE_STAMP};
  const plan=planSharedPages([race],[{page_url:INDEX,status:'parsed',body_sha:'fixture',parser_version:SHARED_PAGE_POLICY.parserVersion,observed_at:FIXTURE_STAMP,findings_json:JSON.stringify(findings)}],FIXTURE_STAMP);
  assert.equal(plan.jobs.length,1);const m=metaFromMeetingListUrl(plan.jobs[0].url);assert.equal(m.date,r.date);assert.equal(m.venue,venue);
 }

});
test('one index serves all 72 exact identities without fetching unrelated cards or repeating calendar/index',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(),requests=[],pages=pageGraph(races);let now=FIXTURE_STAMP,formal=0;
 for(let i=0;i<76;i++){const r=await runSharedPageStep(db,input(races),{now:()=>now,fetcher:fixtureFetcher(pages,requests)});formal+=Number(r.formalCardSaved||false);assert.ok(r.externalRequests<=1);now+=61000;if(r.status==='complete')break;}
 assert.equal(formal,72);assert.equal(requests.length,74);assert.equal(requests.filter(x=>x===INDEX).length,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,72);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_runners').get().n,144);
 const race=races[0],key=`${race.date}:${race.venue}:${race.raceNo}`,saved=sql.prepare('SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').all(key),e=sql.prepare('SELECT * FROM lab_card_source_evidence WHERE race_key=?').get(key);
 assert.equal(e.runner_sha256,await sha256(runnerFingerprint(saved)));assert.equal(e.source_sha256,await sha256(pages.get(cardUrl(race))));await requireLockEvidence(db,{race_key:key},saved);sql.close();
});
test('nested synthetic index/meeting/race graph is traversed one page at a time with shared meeting pages',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(),requests=[];let now=FIXTURE_STAMP,formal=0;
 for(let i=0;i<90;i++){const r=await runSharedPageStep(db,input(races),{now:()=>now,fetcher:fixtureFetcher(pageGraph(races,{nested:true}),requests)});formal+=Number(r.formalCardSaved||false);now+=61000;if(r.status==='complete')break;}
 assert.equal(formal,72);assert.equal(new Set(requests).size,requests.length);assert.equal(requests.length,81);sql.close();
});
test('restart after body saved/parse failure reuses same immutable body without another source request',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1).slice(0,1),requests=[];let now=FIXTURE_STAMP;
 let r=await runSharedPageStep(db,input(races),{now:()=>now,fetcher:fixtureFetcher(pageGraph(races),requests),parser:()=>{throw Error('parser crash')}});assert.equal(r.bodyStored,true);assert.equal(requests.length,1);assert.equal(rows(sql)[0].status,'parse-failed');
 now+=61000;r=await runSharedPageStep(db,input(races),{now:()=>now,fetcher:()=>assert.fail('no repeated source'),parserVersion:'fixed-local-parser'});assert.equal(r.status,'page-parsed');assert.equal(r.externalRequests,0);assert.equal(requests.length,1);
 const body=sql.prepare('SELECT * FROM lab_shared_page_bodies_v1').get();assert.equal(await sha256(body.body_html),body.sha256);assert.throws(()=>sql.exec("UPDATE lab_shared_page_bodies_v1 SET body_html='changed'"),/immutable/);assert.throws(()=>sql.exec('DELETE FROM lab_shared_page_bodies_v1'),/immutable/);sql.close();
});
test('lost acknowledgement after atomic body/receipt commit recovers without refetch',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1).slice(0,1),requests=[];let now=FIXTURE_STAMP,fail=true;
 const wrapped={...db,async batch(ss){const result=await db.batch(ss);if(fail){fail=false;throw Error('lost response after commit')}return result;}};
 const first=await runSharedPageStep(wrapped,input(races),{now:()=>now,fetcher:fixtureFetcher(pageGraph(races),requests)});assert.equal(first.saveMayHaveSucceeded,true);assert.equal(rows(sql)[0].status,'body-stored');
 now+=61000;const recovered=await runSharedPageStep(db,input(races),{now:()=>now,fetcher:()=>assert.fail('no refetch')});assert.equal(recovered.status,'page-parsed');assert.equal(recovered.externalRequests,0);assert.equal(requests.length,1);sql.close();
});
test('403/429/503 advance the unchanged shared gate by one hour; another venue cannot bypass',async()=>{
 for(const status of [403,429,503]){const {db,sql}=await fixtureDatabase();let calls=0;const races=racesFixture(1),deps={now:()=>FIXTURE_STAMP,fetcher:async()=>{calls++;return new Response('',{status})}};
  const first=await runSharedPageStep(db,input(races),deps);assert.match(first.error,new RegExp(String(status)));assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,FIXTURE_STAMP+3600000);
  assert.equal((await runSharedPageStep(db,input(races.slice(12)),deps)).status,'cooldown');assert.equal(calls,1);sql.close();}
});
test('held shared lease and a lost atomic claim cause zero external calls',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1);sql.prepare('UPDATE lab_history_collection_budget SET locked_until=?').run(FIXTURE_STAMP+1000);
 assert.equal((await runSharedPageStep(db,input(races),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail('lease')})).status,'cooldown');
 sql.prepare('UPDATE lab_history_collection_budget SET locked_until=0').run();const raceDb={...db,prepare(q){if(q.startsWith('UPDATE lab_history_collection_budget SET locked_until=?'))return{bind(){return{async run(){return{meta:{changes:0}}}}}};return db.prepare(q)}};
 assert.equal((await runSharedPageStep(raceDb,input(races),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail('lost claim')})).status,'lease-unavailable');sql.close();
});
test('D1 quota propagation stops same-binding subsequent scheduled attempts before further queries',async()=>{
 const {db,sql}=await fixtureDatabase();let calls=0;const broken={prepare(){calls++;throw Error('exceeded D1 daily row read limit')}};
 const first=await runWithScheduledReadBudget(broken,()=>runSharedPageStep(broken,input(racesFixture()),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail()}),()=>FIXTURE_STAMP);assert.equal(first.reason,'d1-daily-read-limit');
 assert.equal((await runSharedPageStep(broken,input(racesFixture()),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail()})).reason,'d1-daily-read-limit');assert.equal(calls,1);sql.close();
});
test('deadline priority, per-page retry exclusion, urgent override and aged distant work are independent',()=>{
 const races=racesFixture(),sat=races[0],sun=races[36];sat.rootUrl=cardUrl(sat);sun.rootUrl=cardUrl(sun);sat.start=Date.parse(sat.startAt);sun.start=Date.parse(sun.startAt);sat.enqueued=sun.enqueued=FIXTURE_STAMP;
 let p=planSharedPages([sun,sat],[],FIXTURE_STAMP);assert.equal(p.jobs[0].url,sat.rootUrl);
 p=planSharedPages([sun,sat],[{page_url:sat.rootUrl,status:'http-or-source-failed',next_at:FIXTURE_STAMP+1}],FIXTURE_STAMP);assert.equal(p.jobs[0].url,sun.rootUrl);
 sun.enqueued=FIXTURE_STAMP-7*3600000;p=planSharedPages([sat,sun],[],FIXTURE_STAMP);assert.equal(p.jobs[0].url,sun.rootUrl);
 sat.start=FIXTURE_STAMP+3600000;p=planSharedPages([sat,sun],[],FIXTURE_STAMP);assert.equal(p.jobs[0].url,sat.rootUrl);
});
test('finished/complete races and wrong-date card links never become fetchable formal cards',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];let calls=0;
 const r=await runSharedPageStep(db,input([{...race,formalSaved:true}]),{now:()=>FIXTURE_STAMP,fetcher:()=>calls++});assert.equal(r.status,'complete');assert.equal(calls,0);
 assert.equal((await runSharedPageStep(db,input([race]),{now:()=>Date.parse(race.startAt),fetcher:()=>calls++})).externalRequests,0);assert.equal(calls,0);
 await assert.rejects(runSharedPageStep(db,input([{...race,cardUrl:cardUrl({...race,date:'2026-10-25'})}]),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail()}),/identity/);sql.close();
});
test('predraw remains a separate preserved page version, never an official card or old roster overwrite',async()=>{
 const {db,sql}=await fixtureDatabase(),r={...racesFixture()[0]};r.cardUrl=cardUrl(r);const url=cardUrl(r),html=`<table><caption>2026年10月24日 東京<img alt="1レース"></caption><thead></thead><tr><td class="waku"></td><td class="num"></td><td class="horse"><div class="name"><a href="https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002023000001/AA">テストア</a></div></td><td class="jockey"><p class="age">牡2/黒鹿</p><p class="weight">55kg</p><p class="jockey">山田</p></td></tr></table>`;
 const result=await runSharedPageStep(db,input([r]),{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(new Map([[url,html]]))});assert.equal(result.status,'predraw-page-preserved');assert.equal(result.formalCardSaved,false);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);assert.equal(rows(sql)[0].status,'predraw');sql.close();
});
test('wrong source header fails closed and stores body for diagnosis without formal writes',async()=>{
 const {db,sql}=await fixtureDatabase(),r=racesFixture()[0];r.cardUrl=cardUrl(r);const result=await runSharedPageStep(db,input([r]),{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(new Map([[r.cardUrl,drawnHtml(r).replace('2026年10月24日','2026年10月25日')]]))});
 assert.match(result.error,/header mismatch/);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);assert.equal(rows(sql)[0].status,'card-ready');assert.equal(rows(sql)[0].next_at,FIXTURE_STAMP+3600000);sql.close();
});
test('graph cycles and page/byte/link caps are bounded, and no arbitrary default fetch exists',async()=>{
 const {db,sql}=await fixtureDatabase(),r=racesFixture()[0];await assert.rejects(runSharedPageStep(db,input([r])),/explicit fetcher/);
 const loop=[{page_url:r.rootUrl,status:'parsed',next_at:0,body_sha:'hash',observed_at:FIXTURE_STAMP,parser_version:SHARED_PAGE_POLICY.parserVersion,findings_json:JSON.stringify({pages:[r.rootUrl],cards:[]})}];const validated={...r,start:Date.parse(r.startAt),enqueued:FIXTURE_STAMP};assert.equal(planSharedPages([validated],loop,FIXTURE_STAMP).jobs.length,0);
 assert.throws(()=>parseSharedPage(Array.from({length:257},(_,i)=>`<a href="https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dle${i}/AA">x</a>`).join(''),r.rootUrl),/bound/);
 const result=await runSharedPageStep(db,input([r]),{now:()=>FIXTURE_STAMP,fetcher:async()=>new Response('x'.repeat(SHARED_PAGE_POLICY.maxBytes+1))});assert.match(result.error,/byte bound/);sql.close();
});
test('source refresh appends an immutable URL/hash/time version while preserving the earlier body',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1).slice(0,1);let now=FIXTURE_STAMP;
 await runSharedPageStep(db,input(races),{now:()=>now,fetcher:async()=>new Response('<p>no published links</p>',{headers:{'content-type':'text/html;charset=utf-8'}})});
 const old=sql.prepare('SELECT * FROM lab_shared_page_bodies_v1').get();now+=3601000;
 await runSharedPageStep(db,input(races),{now:()=>now,fetcher:fixtureFetcher(pageGraph(races))});
 const versions=sql.prepare('SELECT * FROM lab_shared_page_bodies_v1 ORDER BY observed_at').all();assert.equal(versions.length,2);assert.deepEqual(versions[0],old);assert.equal(versions[1].page_url,races[0].rootUrl);assert.notEqual(versions[1].sha256,old.sha256);sql.close();
});
test('existing child findings are followed before refreshing stale parent pages',()=>{
 const race=racesFixture()[0],now=FIXTURE_STAMP+2*3600000,child=meetingUrl(race),version=SHARED_PAGE_POLICY.parserVersion;
 const record={page_url:race.rootUrl,status:'parsed',next_at:0,body_sha:'source',observed_at:FIXTURE_STAMP,parser_version:version,findings_json:JSON.stringify({pages:[child],cards:[]})};
 const p=planSharedPages([{...race,start:Date.parse(race.startAt),enqueued:FIXTURE_STAMP}],[record],now);assert.equal(p.jobs[0].url,child);
});
test('source cache storage budget is checked before network; no silent pruning of earlier evidence',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];sql.prepare('INSERT INTO lab_shared_page_bodies_v1(scope_key,page_url,sha256,body_html,byte_length,observed_at) VALUES(?,?,?,?,?,?)').run(SCOPE,race.rootUrl,'fixture','x',SHARED_PAGE_POLICY.maxStoredBodyBytes,FIXTURE_STAMP);
 const r=await runSharedPageStep(db,input([race]),{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail('storage full')});assert.equal(r.status,'source-storage-budget');assert.equal(r.externalRequests,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_shared_page_bodies_v1').get().n,1);sql.close();
});
test('stored formal body recovers a lost card-save acknowledgement without rewriting existing evidence or predictions',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];race.cardUrl=cardUrl(race);let now=FIXTURE_STAMP;
 sql.exec("CREATE TABLE protected_snapshots(id TEXT PRIMARY KEY,body TEXT,sha TEXT,saved_at TEXT,locked INTEGER);INSERT INTO protected_snapshots VALUES('old21','old21json','oldsha','oldtime',1),('formal18','formal18json','formalsha','formaltime',0),('comparison18','comparisonjson','comparisonsha','comparisontime',0)");
 const before=sql.prepare('SELECT * FROM protected_snapshots').all();const first=await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:fixtureFetcher(pageGraph([race]))});assert.equal(first.formalCardSaved,true);
 const evidence=sql.prepare('SELECT * FROM lab_card_source_evidence').get(),runners=sql.prepare('SELECT * FROM jra_runners').all();sql.prepare("UPDATE lab_shared_page_receipts_v1 SET status='card-ready',next_at=0").run();now+=61000;
 const recovered=await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:()=>assert.fail('stored formal body')});assert.equal(recovered.status,'existing-card-reconciled');assert.equal(recovered.formalCardSaved,false);assert.equal(recovered.externalRequests,0);
 assert.deepEqual(sql.prepare('SELECT * FROM lab_card_source_evidence').get(),evidence);assert.deepEqual(sql.prepare('SELECT * FROM jra_runners').all(),runners);assert.deepEqual(sql.prepare('SELECT * FROM protected_snapshots').all(),before);sql.close();
});
test('an existing official card with different source SHA is never silently relabelled to a new body',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];race.cardUrl=cardUrl(race);let now=FIXTURE_STAMP;
 await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:fixtureFetcher(pageGraph([race]))});const evidence=sql.prepare('SELECT * FROM lab_card_source_evidence').get();
 sql.prepare("UPDATE lab_shared_page_receipts_v1 SET status='http-or-source-failed',next_at=0,body_sha=NULL").run();now+=61000;
 const result=await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:async()=>new Response(drawnHtml(race)+'<!-- later page -->',{headers:{'content-type':'text/html;charset=utf-8'}})});assert.match(result.error,/refusing evidence rewrite/);assert.deepEqual(sql.prepare('SELECT * FROM lab_card_source_evidence').get(),evidence);sql.close();
});
test('per-page version cap yields to another eligible page instead of stopping the whole week',async()=>{
 const {db,sql}=await fixtureDatabase(),races=[racesFixture()[0],racesFixture()[36]],requests=[];
 for(let i=0;i<4;i++)sql.prepare('INSERT INTO lab_shared_page_bodies_v1(scope_key,page_url,sha256,body_html,byte_length,observed_at) VALUES(?,?,?,?,?,?)').run(SCOPE,races[0].rootUrl,'fixture'+i,'x',1,FIXTURE_STAMP);
 const r=await runSharedPageStep(db,input(races),{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(pageGraph(races),requests)});assert.equal(r.externalRequests,1);assert.equal(requests[0],races[1].rootUrl);sql.close();
});
test('a source response crossing the five-minute cutoff is preserved but never passed to the card writer',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];let now=Date.parse(race.startAt)-300100;race.cardUrl=cardUrl(race);
 const r=await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:async()=>{now+=200;return new Response(drawnHtml(race),{headers:{'content-type':'text/html;charset=utf-8'}})}});assert.equal(r.status,'deadline-passed');assert.equal(r.formalCardSaved,false);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_shared_page_bodies_v1').get().n,1);sql.close();
});
test('existing history dispatcher can delegate one source slot without fallthrough or a second fetch',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1),requests=[];let cards=0;
 const r=await collectLiveHistory(db,{scheduledTime:FIXTURE_STAMP},{now:()=>FIXTURE_STAMP,missing:async()=>({status:'official-card-priority',externalRequests:0}),registered:async()=>races,cards:async()=>{cards++;return runSharedPageStep(db,input(races),{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(pageGraph(races),requests)})},programs:()=>assert.fail('must not fall through to another source')});
 assert.equal(cards,1);assert.equal(r.externalRequests,1);assert.equal(requests.length,1);sql.close();
});
test('shared formal card feeds the unchanged scheduled prediction writer and independent hash readback in SQLite',async()=>{
 const {db,sql}=await fixtureDatabase(),r=racesFixture()[0];r.cardUrl=cardUrl(r);const source=await runSharedPageStep(db,input([r]),{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(pageGraph([r]))});assert.equal(source.formalCardSaved,true);
 await ensureHistoryTable(db);sql.exec('CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(r.date,r.venue,r.raceNo,r.startAt.slice(11,16),r.rootUrl);
 for(const name of ['テストア','テストイ'])for(const date of ['2026-09-01','2026-09-15','2026-10-01'])sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name,date,'東京','隔離検証','芝',1600,2,12,'良','https://www.jra.go.jp/profile',new Date(FIXTURE_STAMP).toISOString());
 const result=await scheduledAutomaticPrediction(db,FIXTURE_STAMP+61000);assert.equal(result.saved,1);const read=await readAutomaticPrediction(db,r);assert.equal(read.integrityVerified,true);assert.equal(read.snapshot.runners.length,2);assert.equal(read.snapshotSha256,await sha256(JSON.stringify(read.snapshot)));assert.ok(read.snapshot.runners.every(x=>x.rank&&x.mark));assert.equal(read.snapshot.guardrails.immutable,true);assert.equal(read.snapshot.guardrails.humanMarksUsed,false);assert.throws(()=>sql.exec('DELETE FROM lab_automatic_predictions_v1'),/immutable/);sql.close();
});
test('an unparsed replacement body cannot lend individual links from its older parsed version',()=>{
 const race=racesFixture()[0],row={page_url:race.rootUrl,status:'body-stored',next_at:0,body_sha:'new-source',observed_at:FIXTURE_STAMP,parser_version:SHARED_PAGE_POLICY.parserVersion,findings_json:JSON.stringify({pages:[],cards:[{...race,url:cardUrl(race)}]})};
 const p=planSharedPages([{...race,start:Date.parse(race.startAt),enqueued:FIXTURE_STAMP}],[row],FIXTURE_STAMP);assert.equal(p.jobs[0].url,race.rootUrl);assert.equal(p.jobs[0].row.body_sha,'new-source');
});
test('planner query omits saved card results and obsolete findings instead of retransferring full receipts',async()=>{
 const {db,sql,stats,reset}=await fixtureDatabase(),race=racesFixture()[0];race.cardUrl=cardUrl(race);let now=FIXTURE_STAMP;
 await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:fixtureFetcher(pageGraph([race]))});sql.prepare('UPDATE lab_shared_page_receipts_v1 SET card_result_json=?').run('x'.repeat(100000));reset();now+=61000;
 const r=await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:()=>assert.fail('already complete')});assert.equal(r.status,'complete');assert.ok(stats.readJsonBytes<3000);const query=stats.executed.find(q=>q.includes('ORDER BY page_url LIMIT'));assert.ok(query&&!query.includes('SELECT *')&&!query.includes('card_result_json'));sql.close();
});

test('selected-source seam keeps collector target and shares sibling navigation without saving the wrong race',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1),selected=races[0],sibling=races[1],later=races[2],root=cardUrl(sibling),requests=[];let now=FIXTURE_STAMP;
 const html=drawnHtml(sibling)+[selected,later].map(r=>`<a href="${cardUrl(r)}">published</a>`).join('');
 const pages=new Map([[root,html],[cardUrl(selected),drawnHtml(selected)],[cardUrl(later),drawnHtml(later)]]);
 const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races},{now:()=>now,fetcher:fixtureFetcher(pages,requests)});
 const source=r=>({date:r.date,venue:r.venue,raceNo:r.raceNo,officialRosterDiscoveryUrl:root});
 const first=await discover(db,source(selected));assert.equal(first.status,'page-parsed');assert.equal(first.externalRequests,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);
 now+=61000;const second=await discover(db,source(later));assert.equal(second.formalCardSaved,true);assert.equal(second.target.raceNo,later.raceNo);assert.equal(requests.length,2);assert.equal(requests[1],cardUrl(later));
 now+=61000;const third=await discover(db,source(selected));assert.equal(third.formalCardSaved,true);assert.equal(requests.length,3);assert.equal(requests.filter(u=>u===root).length,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races WHERE race_no=?').get(sibling.raceNo).n,0);
 now+=61000;const own=await discover(db,{...source(sibling),officialCardUrl:root});assert.equal(own.formalCardSaved,true);assert.equal(own.externalRequests,0);assert.equal(requests.length,3);assert.equal(own.target.raceNo,sibling.raceNo);sql.close();
});
test('selected-source seam rejects unknown or duplicate identities and keeps shared cooldown',async()=>{
 const {db,sql}=await fixtureDatabase(),races=racesFixture(1),race=races[0],source={...race,officialRosterDiscoveryUrl:race.rootUrl};
 const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races},{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail('no network')});
 await assert.rejects(discover(db,{...source,raceNo:99}),/existing inventory/);
 await assert.rejects(createSharedSelectedCardDiscoverer({scope:SCOPE,races:[race,race]})(db,source),/existing inventory/);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=?').run(FIXTURE_STAMP+3600000);
 const wait=await discover(db,source);assert.equal(wait.status,'cooldown');assert.equal(wait.externalRequests,0);sql.close();
});

test('selected shared handoff resumes the existing discovery receipt without another calendar request',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0],requests=[],snapshotId='official-card:'+race.date+':'+race.venue+':'+race.raceNo+':official-program';
 const receipt={snapshot_id:snapshotId,card_url:cardUrl(race),next_attempt_at:FIXTURE_STAMP-1,status:'official-card-link-found'};
 const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races:[race]},{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(pageGraph([race]),requests)});
 const r=await discover(db,{...race,snapshotId,officialRosterDiscoveryUrl:race.rootUrl,discoveryReceipt:receipt});
 assert.equal(r.formalCardSaved,true);assert.deepEqual(requests,[cardUrl(race)]);assert.equal(r.attempted,true);sql.close();
});
test('legacy receipt cooldown and wrong-target links fail before shared-store reads or network',async()=>{
 const race=racesFixture()[0],snapshotId='legacy-id',source={...race,snapshotId,officialRosterDiscoveryUrl:race.rootUrl};
 const db={prepare(){assert.fail('no SQL before deferred or invalid receipt')}};
 const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races:[race]},{now:()=>FIXTURE_STAMP,fetcher:()=>assert.fail('no fetch')});
 const wait=await discover(db,{...source,discoveryReceipt:{snapshot_id:snapshotId,next_attempt_at:FIXTURE_STAMP+1000,card_url:cardUrl(race)}});
 assert.equal(wait.status,'card-discovery-not-due');assert.equal(wait.externalRequests,0);
 await assert.rejects(discover(db,{...source,discoveryReceipt:{snapshot_id:snapshotId,next_attempt_at:0,card_url:cardUrl({...race,venue:'京都'})}}),/receipt.*identity/i);
 await assert.rejects(discover(db,{...source,discoveryReceipt:{snapshot_id:'other-id',next_attempt_at:0,card_url:cardUrl(race)}}),/receipt.*identity/i);
});
test('cached navigation consumes the selected history stage without falling through to a second source stage',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0];let now=FIXTURE_STAMP;
 await runSharedPageStep(db,input([race]),{now:()=>now,fetcher:fixtureFetcher(pageGraph([race])),parser:()=>{throw Error('saved body awaits parser')}});now+=61000;
 const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races:[race]},{now:()=>now,parserVersion:'resume-parser',fetcher:()=>assert.fail('cached body')});
 const source={...race,officialRosterDiscoveryUrl:race.rootUrl};
 const result=await collectLiveHistory(db,{scheduledTime:now},{now:()=>now,registered:async()=>[race],missing:async()=>({status:'official-card-priority',externalRequests:0}),cards:()=>discover(db,source),programs:()=>assert.fail('cached work must not fall through')});
 assert.equal(result.status,'page-parsed');assert.equal(result.externalRequests,0);assert.equal(result.historyWorkStage,'acquisition');sql.close();
});

test('existing Kyoto/Niigata candidate selector passes its receipt to shared continuation without a duplicate receipt SELECT',async()=>{
 for(const venue of ['京都','新潟'])for(const meetingReceipt of [false,true]){
  const {readFile}=await import('node:fs/promises'),{metaFromMeetingListUrl}=await import('../src/index-v1.1.4.js');
  const actual=JSON.parse(await readFile(new URL('./fixtures/jra-meeting-links-20261024.json',import.meta.url),'utf8'));
  const resumeUrl=meetingReceipt?actual.links.find(u=>{const m=metaFromMeetingListUrl(u);return m?.date==='2026-10-24'&&m.venue===venue}):INDEX;
  const {db,sql,stats,reset}=await fixtureDatabase(),race=racesFixture().find(r=>r.venue===venue&&r.raceNo===1),requests=[];let now=FIXTURE_STAMP;
  sql.exec('CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,card_url TEXT,next_attempt_at INTEGER,status TEXT,error TEXT)');
  const snapshotId=`official-card:${race.date}:${venue}:1:official-program`;
  sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(race.date,venue,1,'09:45',race.rootUrl);
  sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?,?)').run(snapshotId,resumeUrl,now-1,'official-card-index-found',null);
  const before=sql.prepare('SELECT * FROM lab_expected_card_discovery').get();
  const pages=pageGraph([race]);pages.set(resumeUrl,pages.get(INDEX));
  const discover=discoverSharedSelectedCard,fetcher=fixtureFetcher(pages,requests);
  sql.exec('DROP TABLE lab_shared_page_receipts_v1;DROP TABLE lab_shared_page_bodies_v1');
  reset();const first=await collectMissingOfficialCard(db,{date:race.date,venue,raceNo:1},{now:()=>now,discover,fetcher});
  assert.equal(first.status,'page-parsed');assert.deepEqual(requests,[resumeUrl]);assert.equal(stats.executed.filter(q=>/FROM lab_expected_card_discovery/.test(q)).length,1);
  now+=61000;const second=await collectMissingOfficialCard(db,{date:race.date,venue,raceNo:1},{now:()=>now,discover,fetcher});
  assert.equal(second.formalCardSaved,true);assert.equal(second.target.venue,venue);assert.deepEqual(requests,[resumeUrl,cardUrl(race)]);
  assert.deepEqual(sql.prepare('SELECT * FROM lab_expected_card_discovery').get(),before);
  const saved=sql.prepare('SELECT horse_no,frame_no,horse_name FROM jra_runners ORDER BY horse_no').all(),evidence=sql.prepare('SELECT runner_sha256 FROM lab_card_source_evidence').get();
  assert.equal(saved.length,2);assert.equal(evidence.runner_sha256,await sha256(runnerFingerprint(saved)));
  await ensureHistoryTable(db);sql.exec('CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT)');
  // Synthetic prior evidence only. No live race data or source fetch here.
  for(const horse of saved)for(const date of ['2026-09-01','2026-09-15','2026-10-01'])sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(horse.horse_name,date,venue,'隔離検証','芝',1600,2,12,'良','https://www.jra.go.jp/profile',new Date(now).toISOString());
  assert.equal((await scheduledAutomaticPrediction(db,now+1000)).saved,1);
  const prediction=await readAutomaticPrediction(db,race);assert.equal(prediction.integrityVerified,true);assert.equal(prediction.snapshotSha256,await sha256(JSON.stringify(prediction.snapshot)));assert.deepEqual(prediction.snapshot.runners.map(r=>r.horseName).sort(),saved.map(r=>r.horse_name).sort());assert.ok(prediction.snapshot.runners.every(r=>r.rank&&r.mark));
  assert.equal(prediction.snapshot.guardrails.humanMarksUsed,false);assert.equal(requests.length,2);assert.throws(()=>sql.exec('DELETE FROM lab_automatic_predictions_v1'),/immutable/);sql.close();
 }
});

test('shared handoff honors a verified sibling meeting URL while retaining exact card and receipt wait',async()=>{
 const race=racesFixture()[0],actual=JSON.parse(await readFile(new URL('./fixtures/jra-meeting-links-20261024.json',import.meta.url),'utf8')),meta=(await import('../src/index-v1.1.4.js')).metaFromMeetingListUrl,meeting=canonicalPublishedPage(actual.links.find(u=>meta(u)?.date===race.date&&meta(u)?.venue===race.venue)),wrong=actual.links.find(u=>meta(u)?.date===race.date&&meta(u)?.venue!==race.venue),id=`official-card:${race.date}:${race.venue}:${race.raceNo}:official-program`;
 for(const mode of ['meeting','card','wait']){
  const {db,sql}=await fixtureDatabase(),requests=[],pages=pageGraph([race]);pages.set(meeting,pages.get(INDEX));
  const discover=createSharedSelectedCardDiscoverer({scope:SCOPE,races:[race]},{now:()=>FIXTURE_STAMP,fetcher:fixtureFetcher(pages,requests)});
  const result=await discover(db,{...race,snapshotId:id,officialRosterDiscoveryUrl:INDEX,officialMeetingListUrl:meeting,discoveryReceipt:{snapshot_id:id,card_url:mode==='card'?cardUrl(race):INDEX,next_attempt_at:mode==='wait'?FIXTURE_STAMP+1000:0}});
  assert.deepEqual(requests,mode==='wait'?[]:[mode==='card'?cardUrl(race):meeting]);
  if(mode==='wait')assert.equal(result.status,'card-discovery-not-due');
  await assert.rejects(discover(db,{...race,officialRosterDiscoveryUrl:INDEX,officialMeetingListUrl:wrong}),/meeting.*identity/i);
  sql.close();
 }
});

test('natural shared connection can retain a started card without creating a retrospective pre-race prediction',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0],now=Date.parse(race.startAt)+60000;
 const result=await discoverSharedSelectedCard(db,{...race,officialRosterDiscoveryUrl:race.rootUrl,officialCardUrl:cardUrl(race)},{now:()=>now,fetcher:fixtureFetcher(pageGraph([race]))});
 assert.equal(result.formalCardSaved,true);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,1);
 await ensureHistoryTable(db);sql.exec('CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT)');sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(race.date,race.venue,race.raceNo,race.startAt.slice(11,16),race.rootUrl);assert.equal((await scheduledAutomaticPrediction(db,now+1000)).saved,0);assert.equal((await readAutomaticPrediction(db,race)).available,false);sql.close();
});

test('natural connection calls the Worker global fetch with its required receiver',async()=>{
 const {db,sql}=await fixtureDatabase(),race=racesFixture()[0],original=globalThis.fetch,calls=[];
 globalThis.fetch=function(url,init){if(this!==globalThis)throw Error('Illegal invocation: incorrect this');return fixtureFetcher(pageGraph([race]),calls)(url,init)};
 try{
  const result=await discoverSharedSelectedCard(db,{...race,officialRosterDiscoveryUrl:race.rootUrl,officialCardUrl:cardUrl(race)},{now:()=>FIXTURE_STAMP});
  assert.equal(result.formalCardSaved,true);assert.deepEqual(calls,[cardUrl(race)]);
 }finally{globalThis.fetch=original;sql.close();}
});
