import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {collectMissingRoster,parseSupplementaryRoster,parseOwnExpectedRoster,supplementaryRosterUrl,expectedRosterSourceUrl} from '../src/missing-roster-acquisition.js';
import {sha256} from '../src/card-evidence.js';
import {storedExpectedSources} from '../src/expected-roster-registry.js';
import {scheduledProvisionalPrediction} from '../src/provisional-prediction-queue.js';
import {readProvisionalPrediction} from '../src/provisional-prediction-snapshots.js';
const now=Date.parse('2026-10-21T02:00:00Z'),p={race_date:'2026-10-24',venue:'東京',race_no:1,meeting_no:4,day_no:8},url='https://race.netkeiba.com/race/shutuba.html?race_id=202605040801',ownUrl='https://own.netkeiba.com/race/shutuba.html?race_id=202605040801';
const html='<a href="?kaisai_date=20261024">date</a><a href="?race_id=202605040801">1R</a><div>4回 東京 8日目</div><table><tr class="HorseList"><td><a href="https://db.netkeiba.com/horse/2024000001/">試験馬</a></td><td>牡2</td></tr></table>';
const ownHtml='<div>10/24(土) 東京 1R</div><a>競馬新聞</a><table><thead><tr><th>馬名</th><th>年齢</th><th>騎手</th></tr></thead><tbody><tr class="HorseList"><td><a href="https://own.netkeiba.com/db/horse.html?id=2024000001">試験馬</a></td><td>牡2</td><td>未定</td></tr></tbody></table><p>※結果・成績・オッズなどは主催者発表を確認</p>';
function fixture(gate=0){const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,meeting_no INTEGER,day_no INTEGER,race_label TEXT);INSERT INTO jra_race_program VALUES('2026-10-24','東京',1,4,8,'2歳未勝利');CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,race_key TEXT,runner_count INTEGER);CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER);CREATE TABLE lab_expected_roster_registry(snapshot_id TEXT PRIMARY KEY,race_key TEXT,record_json TEXT,source_sha256 TEXT,stored_at TEXT);CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER,lock_token TEXT);INSERT INTO lab_history_collection_budget VALUES('jra-history',${gate},0,NULL)`);const db={prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}}});return w()}};return{sql,db};}
test('legacy supplementary identity remains strict and the expected source uses the same race identity',()=>{assert.equal(supplementaryRosterUrl(p),url);assert.equal(expectedRosterSourceUrl(p),ownUrl);assert.equal(parseSupplementaryRoster(html,p,url)[0].horseName,'試験馬');assert.throws(()=>parseSupplementaryRoster(html.replace('20261024','20261025'),p,url));assert.throws(()=>parseSupplementaryRoster(html.replace('4回 東京','3回 東京'),p,url));assert.throws(()=>parseSupplementaryRoster(html.replace('HorseList','Unknown'),p,url));});
test('OWN expected roster parser requires matching date, venue, race and horse evidence',()=>{assert.equal(parseOwnExpectedRoster(ownHtml,p,ownUrl)[0].horseName,'試験馬');assert.throws(()=>parseOwnExpectedRoster(ownHtml.replace('10/24(土)','10/25(日)'),p,ownUrl),/開催日/);assert.throws(()=>parseOwnExpectedRoster(ownHtml.replace('東京 1R','京都 1R'),p,ownUrl),/開催場/);assert.throws(()=>parseOwnExpectedRoster(ownHtml.replace('東京 1R','東京 2R'),p,ownUrl),/レース番号/);assert.throws(()=>parseOwnExpectedRoster(ownHtml.replace('牡2',''),p,ownUrl),/馬名・年齢/);assert.throws(()=>parseOwnExpectedRoster(ownHtml.replace('2024000001','bad'),p,ownUrl),/名簿公開/);assert.throws(()=>parseOwnExpectedRoster(ownHtml,p,url),/取得先/);});
test('one bounded OWN source request saves an immutable expected roster and respects hourly cadence',async()=>{const {db,sql}=fixture();let calls=0,requested='';const deps={now:()=>now,fetcher:async(u)=>{calls++;requested=u;return new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})}};const r=await collectMissingRoster(db,null,deps);assert.equal(r.status,'roster-saved',JSON.stringify(r));assert.equal(requested,ownUrl);assert.equal(r.storedRunners,1);assert.equal(r.independentRosterReadback,true);assert.equal(r.formalCardSaved,false);const saved=sql.prepare('SELECT record_json FROM lab_expected_roster_registry').get();assert.equal(JSON.parse(saved.record_json).kind,'expected-runners');assert.equal(JSON.parse(saved.record_json).runners[0].horseNo,undefined);await collectMissingRoster(db,null,deps);assert.equal(calls,1);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);sql.close();});
test('shared cooldown makes no request; 403 pauses the shared gate and records a bounded retry',async()=>{let calls=0;const a=fixture(now+1000);assert.equal((await collectMissingRoster(a.db,null,{now:()=>now,fetcher:async()=>{calls++;throw Error('unexpected')}})).status,'cooldown');assert.equal(calls,0);a.sql.close();const b=fixture();const r=await collectMissingRoster(b.db,null,{now:()=>now,fetcher:async()=>new Response('',{status:403})});assert.equal(r.status,'source-blocked');assert.equal(r.httpStatus,403);assert.equal(b.sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,now+3600000);assert.equal(b.sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);b.sql.close();});
test('unconfirmed first race stays queued while another race can acquire its roster next hour',async()=>{const {db,sql}=fixture();sql.exec("INSERT INTO jra_race_program VALUES('2026-10-24','東京',2,4,8,'2歳未勝利')");const a=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>new Response('<p>calendar only</p>',{headers:{'content-type':'text/html; charset=utf-8'}})});assert.equal(a.status,'publication-unconfirmed');assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);const secondHtml=ownHtml.replace('1R','2R').replace('試験馬','試験馬2').replace('2024000001','2024000002');const b=await collectMissingRoster(db,null,{now:()=>now+3600000,fetcher:async()=>new Response(secondHtml,{headers:{'content-type':'text/html; charset=utf-8'}})});assert.equal(b.status,'roster-saved');assert.equal(b.target,'2026-10-24:東京:2');assert.equal(sql.prepare("SELECT status FROM lab_missing_roster_sources_v1 WHERE race_key='2026-10-24:東京:1'").get().status,'publication-unconfirmed');sql.close();});
test('Worker-compatible manual redirects never follow another race or persist a redirect response',async()=>{const {db,sql}=fixture();let calls=0;const r=await collectMissingRoster(db,null,{now:()=>now,fetcher:async(u,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{location:'https://example.com/other-race'}})}});assert.equal(calls,1);assert.equal(r.status,'fetch-failed');assert.equal(r.httpStatus,302);assert.equal(r.saveMayHaveSucceeded,false);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);sql.close();});

test('uncertain roster INSERT reconciles without fetch or rewrite and returns identifiers for independent GET',async()=>{
 const {db,sql}=fixture();let fail=true;const recoveryQueries=[];
 const wrapped={prepare(q){if(!fail)recoveryQueries.push(q);if(fail&&q==='SELECT record_json FROM lab_expected_roster_registry WHERE snapshot_id=?')return{bind(){return{async first(){return null}}}};return db.prepare(q)}};
 const first=await collectMissingRoster(wrapped,null,{now:()=>now,fetcher:async()=>new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})});
 assert.equal(first.status,'pending-roster-readback');assert.equal(first.saveMayHaveSucceeded,true);
 const before=sql.prepare('SELECT * FROM lab_expected_roster_registry').get();fail=false;
 const next=await collectMissingRoster(wrapped,null,{now:()=>now+3600000,fetcher:()=>assert.fail('must reuse persisted roster')});
 assert.equal(next.status,'roster-reconciled');assert.equal(next.snapshotId,before.snapshot_id);assert.equal(next.storedRunners,1);assert.equal(next.newRosterRaces,0);assert.equal(next.externalRequests,0);assert.equal(next.formalCardSaved,false);
 assert.equal(next.savedAt,before.stored_at);assert.equal(next.snapshotSha256,before.snapshot_id);assert.equal(next.snapshotSha256,await (await import('../src/card-evidence.js')).sha256(before.record_json));
 assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);assert.equal(recoveryQueries.some(q=>/INSERT\s+INTO\s+lab_expected_roster_registry/i.test(q)),false);
 assert.deepEqual(sql.prepare('SELECT * FROM lab_expected_roster_registry').get(),before);sql.close();
});

test('reconciliation rejects a hash-valid roster for a different target without credit or rewrite',async()=>{
 const {sha256}=await import('../src/card-evidence.js'),{db,sql}=fixture();
 const record=JSON.stringify({date:'2026-10-25',venue:'新潟',raceNo:2,runners:[{horseName:'別レースの馬',age:2}]}),hash=await sha256(record);
 sql.prepare('INSERT INTO lab_expected_roster_registry VALUES(?,?,?,?,?)').run(hash,'2026-10-24:東京:1',record,'source-hash',new Date(now).toISOString());
 sql.exec("CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT,next_at INTEGER);INSERT INTO lab_missing_roster_sources_v1 VALUES('2026-10-24:東京:1','pending-roster-readback',0)");
 const before=sql.prepare('SELECT * FROM lab_expected_roster_registry').get();
 await assert.rejects(collectMissingRoster(db,null,{now:()=>now,fetcher:()=>assert.fail('no fetch on conflicting saved target')}),/対象・頭数不一致/);
 assert.equal(sql.prepare('SELECT status FROM lab_missing_roster_sources_v1').get().status,'pending-roster-readback');assert.deepEqual(sql.prepare('SELECT * FROM lab_expected_roster_registry').get(),before);sql.close();
});


test('partial official runner rows do not exclude an unsaved candidate roster',async()=>{
 const {db,sql}=fixture();const key='2026-10-24:東京:1';
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?)').run('2026-10-24','東京',1,key,3);
 sql.prepare('INSERT INTO jra_runners VALUES(?,?)').run(key,1);
 let calls=0;const r=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>{calls++;return new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(r.status,'roster-saved',JSON.stringify(r));assert.equal(r.target,key);assert.equal(r.newRosterRaces,1);assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT runner_count FROM jra_races WHERE race_key=?').get(key).runner_count,3);
 assert.equal(sql.prepare('SELECT count(*) n FROM jra_runners WHERE race_key=?').get(key).n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);
 sql.close();
});

test('complete official card still excludes candidate roster acquisition',async()=>{
 const {db,sql}=fixture();const key='2026-10-24:東京:1';
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?)').run('2026-10-24','東京',1,key,1);
 sql.prepare('INSERT INTO jra_runners VALUES(?,?)').run(key,1);
 let calls=0;const r=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>{calls++;return new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(r.status,'no-due-missing-roster');assert.equal(r.externalRequests,0);assert.equal(calls,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,0);
 sql.close();
});

test('an existing expected roster is not fetched or saved a second time',async()=>{
 const {db,sql}=fixture();let calls=0;
 const first=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>{calls++;return new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(first.status,'roster-saved');const before=sql.prepare('SELECT snapshot_id,record_json,stored_at FROM lab_expected_roster_registry').get();
 const second=await collectMissingRoster(db,null,{now:()=>now+3600000,fetcher:()=>{calls++;throw Error('unexpected refetch')}});
 assert.equal(second.status,'no-due-missing-roster');assert.equal(second.externalRequests,0);assert.equal(calls,1);
 assert.deepEqual(sql.prepare('SELECT snapshot_id,record_json,stored_at FROM lab_expected_roster_registry').get(),before);
 sql.close();
});

test('an active shared lease still blocks roster acquisition without an external request',async()=>{
 const {db,sql}=fixture();sql.prepare("UPDATE lab_history_collection_budget SET locked_until=? WHERE name='jra-history'").run(now+1000);
 let calls=0;const r=await collectMissingRoster(db,null,{now:()=>now,fetcher:()=>{calls++;throw Error('unexpected request')}});
 assert.equal(r.status,'cooldown');assert.equal(r.externalRequests,0);assert.equal(calls,0);
 sql.close();
});

test('cached OWN receipt resumes roster persistence during external cooldown without spending an HTTP slot',async()=>{
 const {db,sql}=fixture(now+1800000),key='2026-10-24:東京:1',bodySha=await sha256(ownHtml);let calls=0;
 sql.exec("CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,source_url TEXT,http_status INTEGER,body_sha256 TEXT,body_html TEXT,observed_at TEXT,error TEXT);CREATE TABLE lab_missing_roster_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)");
 sql.prepare('INSERT INTO lab_missing_roster_sources_v1 VALUES(?,?,?,?,?,?,?,?,?)').run(key,'source-received',now+3600000,ownUrl,200,bodySha,ownHtml,new Date(now).toISOString(),null);
 sql.prepare("INSERT INTO lab_missing_roster_clock_v1 VALUES('source',?)").run(now+3600000);
 const r=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>{calls++;throw Error('cached receipt must not fetch')}});
 assert.equal(r.status,'roster-saved',JSON.stringify(r));assert.equal(r.externalRequests,0);assert.equal(calls,0);assert.equal(r.storedRunners,1);
 assert.equal(sql.prepare("SELECT next_batch_at FROM lab_history_collection_budget WHERE name='jra-history'").get().next_batch_at,now+1800000);
 assert.equal(sql.prepare("SELECT next_at FROM lab_missing_roster_clock_v1 WHERE name='source'").get().next_at,now+3600000);
 sql.close();
});

test('OWN roster feeds the existing provisional snapshot writer and independent SHA readback',async()=>{
 const {db,sql}=fixture();
 const acquired=await collectMissingRoster(db,null,{now:()=>now,fetcher:async()=>new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})});
 assert.equal(acquired.status,'roster-saved');
 const expected=await storedExpectedSources(db,'2026-10-24','2026-10-24');
 const source=expected.find(r=>r.raceKey==='2026-10-24:東京:1');assert.ok(source);assert.deepEqual(source.names,['試験馬']);
 const result=await scheduledProvisionalPrediction(db,now,{prepareRoster:async()=>({status:'no-reviewed-candidate',saved:0,externalRequests:0}),sources:async()=>expected,repair:async()=>({repaired:0}),build:async(_db,s)=>({ok:true,status:'provisional-expected-roster',race:{date:s.date,venue:s.venue,raceNo:s.raceNo,raceName:s.raceName},runnerCount:s.names.length,runners:s.names.map((horseName,i)=>({horseName,horseNo:null,frameNo:null,rank:i+1,score:80,mark:i?'○':'◎'})),guardrails:{humanMarksUsed:false,officialCard:false,locked:false,eligibleForLearning:false}})});
 assert.equal(result.status,'verified',JSON.stringify(result));assert.equal(result.target,'2026-10-24:東京:1');assert.equal(result.saved,1);assert.equal(result.integrityVerified,true);
 const read=await readProvisionalPrediction(db,source,{exact:true});assert.equal(read.integrityVerified,true);assert.equal(read.snapshotSha256,result.snapshotSha256);assert.deepEqual(read.snapshot.runners.map(r=>r.horseName),source.names);
 assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);assert.equal(sql.prepare('SELECT count(*) n FROM lab_provisional_predictions_v1').get().n,1);sql.close();
});

test('legacy-source receipt is not reused as OWN and a fresh OWN request waits for its natural slot',async()=>{
 const {db,sql}=fixture(),key='2026-10-24:東京:1',legacyUrl=supplementaryRosterUrl(p),legacyHtml='<html><title>generic empty shell</title></html>';let calls=0;
 sql.exec("CREATE TABLE lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,source_url TEXT,http_status INTEGER,body_sha256 TEXT,body_html TEXT,observed_at TEXT,error TEXT);CREATE TABLE lab_missing_roster_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)");
 sql.prepare('INSERT INTO lab_missing_roster_sources_v1 VALUES(?,?,?,?,?,?,?,?,?)').run(key,'source-received',0,legacyUrl,200,await sha256(legacyHtml),legacyHtml,new Date(now-3600000).toISOString(),null);
 sql.prepare("INSERT INTO lab_missing_roster_clock_v1 VALUES('source',?)").run(now+3600000);
 const limited=await collectMissingRoster(db,null,{now:()=>now,fetcher:()=>{calls++;throw Error('must respect source clock')}});
 assert.equal(limited.status,'source-not-due');assert.equal(limited.externalRequests,0);assert.equal(calls,0);
 const saved=await collectMissingRoster(db,null,{now:()=>now+3600000,fetcher:async requested=>{calls++;assert.equal(requested,ownUrl);return new Response(ownHtml,{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(saved.status,'roster-saved',JSON.stringify(saved));assert.equal(saved.externalRequests,1);assert.equal(calls,1);assert.equal(saved.storedRunners,1);
 assert.equal(sql.prepare('SELECT source_url FROM lab_missing_roster_sources_v1').get().source_url,ownUrl);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);sql.close();
});
