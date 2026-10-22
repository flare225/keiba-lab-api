import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {missingOfficialCards,collectMissingOfficialCard} from '../src/missing-official-cards.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER,source_url TEXT);CREATE TABLE jra_runners(race_key TEXT);CREATE TABLE lab_history_collection_budget(name TEXT,next_batch_at INTEGER,locked_until INTEGER DEFAULT 0);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0);");const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(q).all(...args)}},async first(){return sql.prepare(q).get(...args)||null}});return wrap()}};return{sql,db};}
const now=Date.parse('2026-10-18T05:15:00Z'),date='2026-10-18';
const card='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0104202604021120261018/AA';
test('missing cards use stored program links and prioritize upcoming races without refetching complete cards',async()=>{
 const {sql,db}=fixture();const put=sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)');
 put.run(date,'新潟',11,'15:20',card);put.run(date,'新潟',4,'11:20','https://www.jra.go.jp/calendar');put.run(date,'京都',11,'15:40','https://www.jra.go.jp/calendar');sql.exec("INSERT INTO jra_races VALUES('complete','2026-10-18','京都',11,1,'https://www.jra.go.jp/card');INSERT INTO jra_runners VALUES('complete')");
 assert.equal((await missingOfficialCards(db,date,now)).missing.length,2);let source;
 const r=await collectMissingOfficialCard(db,{date},{now:()=>now,discover:async(_db,s)=>{source=s;return{ok:true,status:'official-card-saved',externalRequests:1}}});
 assert.equal(r.target.venue,'新潟');assert.equal(r.target.raceNo,11);assert.equal(source.officialCardUrl,card);assert.equal(r.predictionRebuilt,false);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=?').run(now+3600000);
 const blocked=await collectMissingOfficialCard(db,{date},{now:()=>now,discover:()=>{throw Error('must not fetch')}});assert.equal(blocked.status,'cooldown');assert.equal(blocked.externalRequests,0);sql.close();
});

test('stored same-day same-venue card navigation is preferred over calendar discovery',async()=>{
 const {sql,db}=fixture();const sibling=card.replace('021120261018','020120261018');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'新潟',11,'15:10','https://www.jra.go.jp/keiba/calendar2026/2026/10/1018.html');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('sibling',date,'新潟',1,1,sibling);
 const p=await missingOfficialCards(db,date,now);assert.equal(p.missing[0].sourceUrl,sibling);assert.equal(p.missing[0].sourceBasis,'stored-sibling-card');
 await collectMissingOfficialCard(db,{date,venue:'新潟',raceNo:11},{now:()=>now,discover:async(_db,s)=>{assert.equal(s.officialRosterDiscoveryUrl,sibling);assert.equal(s.officialCardUrl,undefined);return{ok:true,status:'official-card-link-found',externalRequests:1}}});sql.close();
});

test('scheduled upcoming-only cards do not consume a slot for finished races',async()=>{
 const {sql,db}=fixture();sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'新潟',4,'11:05',card);
 const r=await collectMissingOfficialCard(db,{date,upcomingOnly:true},{now:()=>now,discover:async()=>assert.fail('must not fetch past card in urgent slot')});assert.equal(r.externalRequests,0);sql.close();
});

test('future official cards stay distinct from the same venue/race number today',async()=>{
 const {sql,db}=fixture();for(const day of [date,'2026-10-24'])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,'東京',11,'15:40','https://www.jra.go.jp/calendar');
 assert.equal((await missingOfficialCards(db,date,now,'2026-10-25')).missing.length,2);
 sql.exec("CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER);INSERT INTO lab_expected_card_discovery VALUES('official-card:2026-10-18:東京:11:official-program',9999999999999)");
 const r=await collectMissingOfficialCard(db,{date,includeFuture:true,upcomingOnly:true},{now:()=>now,discover:async(_,s)=>{assert.equal(s.date,'2026-10-24');return{ok:true,externalRequests:1}}});assert.equal(r.target.date,'2026-10-24');sql.close();
});
test('shared cooldown is checked before scanning programs or histories',async()=>{
 let queries=0;const db={prepare(query){queries++;assert.match(query,/SELECT next_batch_at,locked_until FROM lab_history_collection_budget/);return{async first(){return{next_batch_at:now+3600000,locked_until:0}}}}};
 assert.equal((await collectMissingOfficialCard(db,{date},{now:()=>now})).status,'cooldown');assert.equal(queries,1);
});

test('all 72 untried weekend cards advance before retrying early cards whose cooldown already expired',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER)');
 for(const day of ['2026-10-24','2026-10-25'])for(const venue of ['東京','京都','新潟'])for(let raceNo=1;raceNo<=12;raceNo++)sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,raceNo,'10:00','https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html');
 let stamp=Date.parse('2026-10-22T05:00:00Z');const seen=[];
 const deps={now:()=>stamp,discover:async(_,s)=>{seen.push(s.snapshotId);sql.prepare('INSERT OR REPLACE INTO lab_expected_card_discovery VALUES(?,?)').run(s.snapshotId,stamp+3600000);return{ok:true,status:'not-published',externalRequests:1}}};
 for(let i=0;i<72;i++){await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);stamp+=18*60000;}
 assert.equal(new Set(seen).size,72);assert.ok(seen.every((x,i)=>seen.indexOf(x)===i));
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(seen[72],seen[0]);sql.close();
});

test('a due card starting within twelve hours takes priority over an untried later meeting',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'新潟',11,'15:20',card);sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',11,'15:40','https://www.jra.go.jp/calendar');
 sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?)').run('official-card:2026-10-18:新潟:11:official-program',now-1);
 const result=await collectMissingOfficialCard(db,{date,includeFuture:true,upcomingOnly:true},{now:()=>now,discover:async(_,s)=>{assert.equal(s.date,date);assert.equal(s.venue,'新潟');return{ok:true,externalRequests:1}}});assert.equal(result.target.date,date);sql.close();
});

test('explicit target restricts SQL and receipt discovery to one race even with includeFuture',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER)');
 for(const day of ['2026-10-24','2026-10-25'])for(const venue of ['東京','京都','新潟'])for(let raceNo=1;raceNo<=12;raceNo++)sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,raceNo,'10:00','https://www.jra.go.jp/calendar');
 const observed=[];const tracked={prepare(q){const statement=db.prepare(q);return{...statement,bind(...args){observed.push({q,args});return statement.bind(...args)}}}};
 const result=await collectMissingOfficialCard(tracked,{date:'2026-10-24',venue:'新潟',race_no:3,includeFuture:true},{now:()=>now,discover:async(_,s)=>{assert.deepEqual([s.date,s.venue,s.raceNo],['2026-10-24','新潟',3]);return{ok:true,externalRequests:1}}});
 assert.equal(result.target.raceNo,3);const program=observed.find(x=>x.q.includes('FROM jra_race_program p'));assert.match(program.q,/WHERE p.race_date=\? AND p.venue=\? AND p.race_no=\? AND NOT EXISTS/);assert.deepEqual(program.args,['2026-10-24','新潟',3]);const receipts=observed.find(x=>x.q.includes('SELECT snapshot_id'));assert.equal(JSON.parse(receipts.args[0]).length,1);sql.close();
});
test('invalid explicit target fails before any DB read, including cooldown lookup',async()=>{
 let reads=0;const db={prepare(){reads++;throw Error('unexpected query')}};
 for(const input of [{date,venue:'新潟'},{date,venue:'新潟',raceNo:13},{date:'bad',venue:'東京',raceNo:1}])await assert.rejects(collectMissingOfficialCard(db,input,{now:()=>now}));assert.equal(reads,0);
});
test('targeted requests reuse complete cards and obey receipt cooldown without external fetch',async()=>{
 const {sql,db}=fixture();sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'新潟',11,'15:20',card);
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER)');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?)').run('official-card:'+date+':新潟:11:official-program',now+3600000);
 const deps={now:()=>now,discover:async()=>assert.fail('must not fetch')},input={date,venue:'新潟',raceNo:11};assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'card-discovery-not-due');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('saved',date,'新潟',11,1,card);sql.prepare('INSERT INTO jra_runners VALUES(?)').run('saved');assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'complete');sql.close();
});

const kikkaDate='2026-10-25',kikkaCard='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604091120261025/39';
test('witnessed official link selects exactly the stored target without replacing its receipt identity',async()=>{
 const {sql,db}=fixture();sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(kikkaDate,'京都',11,'15:40','https://www.jra.go.jp/keiba/calendar2026/2026/10/1025.html');
 let calls=0;const r=await collectMissingOfficialCard(db,{date:kikkaDate,venue:'京都',raceNo:11,officialCardUrl:kikkaCard},{now:()=>now,discover:async(_,source)=>{calls++;assert.equal(source.officialCardUrl,kikkaCard);assert.equal(source.officialRosterDiscoveryUrl,kikkaCard);assert.equal(source.snapshotId,'official-card:2026-10-25:京都:11:official-program');return{ok:true,status:'official-card-saved',externalRequests:1};}});
 assert.equal(calls,1);assert.equal(r.predictionRebuilt,false);sql.close();
});
test('witnessed link rejects absent or mismatched targets and non-card endpoints before DB access',async()=>{
 let reads=0;const db={prepare(){reads++;throw Error('invalid source must not access DB')}};
 for(const input of [
  {date:kikkaDate,officialCardUrl:kikkaCard},
  {date:kikkaDate,venue:'東京',raceNo:11,officialCardUrl:kikkaCard},
  {date:kikkaDate,venue:'京都',raceNo:10,officialCardUrl:kikkaCard},
  {date:'2026-10-24',venue:'京都',raceNo:11,officialCardUrl:kikkaCard},
  {date:kikkaDate,venue:'京都',raceNo:11,officialCardUrl:kikkaCard.replace('www.jra.go.jp','example.com')},
  {date:kikkaDate,venue:'京都',raceNo:11,officialCardUrl:kikkaCard.replace('accessD.html','accessS.html')}
 ])await assert.rejects(collectMissingOfficialCard(db,input,{now:()=>now}));
 assert.equal(reads,0);
});
test('witnessed link cannot bypass shared gate, lease, receipt wait or saved card exclusion',async()=>{
 const {sql,db}=fixture(),input={date:kikkaDate,venue:'京都',raceNo:11,officialCardUrl:kikkaCard},deps={now:()=>now,discover:()=>assert.fail('must not fetch')};
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(kikkaDate,'京都',11,'15:40','https://www.jra.go.jp/calendar');
 for(const column of ['next_batch_at','locked_until']){sql.prepare('UPDATE lab_history_collection_budget SET '+column+'=?').run(now+3600000);assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'cooldown');sql.prepare('UPDATE lab_history_collection_budget SET '+column+'=0').run();}
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER)');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?)').run('official-card:'+kikkaDate+':京都:11:official-program',now+3600000);
 assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'card-discovery-not-due');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('saved',kikkaDate,'京都',11,1,kikkaCard);sql.prepare('INSERT INTO jra_runners VALUES(?)').run('saved');assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'complete');sql.close();
});
