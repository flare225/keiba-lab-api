import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {missingOfficialCards,collectMissingOfficialCard} from '../src/missing-official-cards.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER,source_url TEXT);CREATE TABLE jra_runners(race_key TEXT);CREATE TABLE lab_history_collection_budget(name TEXT,next_batch_at INTEGER,locked_until INTEGER DEFAULT 0);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0);");const db={prepare(q){const wrap=(args=[])=>({bind(...a){return wrap(a)},async all(){return{results:sql.prepare(q).all(...args)}},async first(){return sql.prepare(q).get(...args)||null},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:Number(r.changes)}}}});return wrap()}};return{sql,db};}
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
 sql.exec("CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT);INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at) VALUES('official-card:2026-10-18:東京:11:official-program',9999999999999)");
 const r=await collectMissingOfficialCard(db,{date,includeFuture:true,upcomingOnly:true},{now:()=>now,discover:async(_,s)=>{assert.equal(s.date,'2026-10-24');return{ok:true,externalRequests:1}}});assert.equal(r.target.date,'2026-10-24');sql.close();
});
test('shared cooldown is checked before scanning programs or histories',async()=>{
 let queries=0;const db={prepare(query){queries++;assert.match(query,/SELECT next_batch_at,locked_until FROM lab_history_collection_budget/);return{async first(){return{next_batch_at:now+3600000,locked_until:0}}}}};
 assert.equal((await collectMissingOfficialCard(db,{date},{now:()=>now})).status,'cooldown');assert.equal(queries,1);
});

test('all 72 untried weekend cards advance before retrying early cards whose cooldown already expired',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const day of ['2026-10-24','2026-10-25'])for(const venue of ['東京','京都','新潟'])for(let raceNo=1;raceNo<=12;raceNo++)sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,raceNo,'10:00','https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html');
 let stamp=Date.parse('2026-10-22T05:00:00Z');const seen=[];
 const deps={now:()=>stamp,discover:async(_,s)=>{seen.push(s.snapshotId);sql.prepare('INSERT OR REPLACE INTO lab_expected_card_discovery(snapshot_id,next_attempt_at,card_url) VALUES(?,?,?)').run(s.snapshotId,stamp+3600000,s.officialCardUrl||null);return{ok:true,status:'not-published',externalRequests:1}}};
 for(let i=0;i<72;i++){await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);stamp+=18*60000;}
 assert.equal(new Set(seen).size,72);assert.ok(seen.every((x,i)=>seen.indexOf(x)===i));
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(seen[72],seen[0]);sql.close();
});

test('a due card starting within twelve hours takes priority over an untried later meeting',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'新潟',11,'15:20',card);sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',11,'15:40','https://www.jra.go.jp/calendar');
 sql.prepare('INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at) VALUES(?,?)').run('official-card:2026-10-18:新潟:11:official-program',now-1);
 const result=await collectMissingOfficialCard(db,{date,includeFuture:true,upcomingOnly:true},{now:()=>now,discover:async(_,s)=>{assert.equal(s.date,date);assert.equal(s.venue,'新潟');return{ok:true,externalRequests:1}}});assert.equal(result.target.date,date);sql.close();
});

test('explicit target restricts SQL and receipt discovery to one race even with includeFuture',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
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
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');sql.prepare('INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at) VALUES(?,?)').run('official-card:'+date+':新潟:11:official-program',now+3600000);
 const deps={now:()=>now,discover:async()=>assert.fail('must not fetch')},input={date,venue:'新潟',raceNo:11};assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'card-discovery-not-due');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('saved',date,'新潟',11,1,card);sql.prepare('INSERT INTO jra_runners VALUES(?)').run('saved');assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'complete');sql.close();
});

const kikkaDate='2026-10-25',kikkaCard='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604091120261025/39';
test('a due calendar-only receipt gets one witnessed-URL opportunity before unrelated untried cards',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-22T11:18:00Z');
 for(const [day,venue,raceNo] of [['2026-10-24','東京',7],[kikkaDate,'京都',11]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,raceNo,'15:40','https://www.jra.go.jp/calendar');
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 sql.prepare('INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at,card_url) VALUES(?,?,NULL)').run('official-card:2026-10-25:京都:11:official-program',stamp-1);
 const visited=[];const deps={now:()=>stamp,discover:async(_,s)=>{visited.push(s);if(s.officialCardUrl)sql.prepare('UPDATE lab_expected_card_discovery SET card_url=?,next_attempt_at=? WHERE snapshot_id=?').run(s.officialCardUrl,stamp-1,s.snapshotId);return{ok:false,status:'failed',externalRequests:1};}};
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(visited[0].venue,'京都');assert.equal(visited[0].officialCardUrl,kikkaCard);
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(visited[1].venue,'東京');sql.close();
});
test('natural card collection hands the witnessed G1 link to the existing collector ahead of calendar-only future cards',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-22T09:00:00Z');
 for(const [day,venue,raceNo] of [['2026-10-24','東京',11],[kikkaDate,'京都',11]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,raceNo,'15:40','https://www.jra.go.jp/keiba/calendar2026/2026/10/1025.html');
 let calls=0;const r=await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},{now:()=>stamp,discover:async(_,s)=>{calls++;assert.equal(s.officialCardUrl,kikkaCard);assert.equal(s.officialRosterDiscoveryUrl,kikkaCard);assert.equal(s.snapshotId,'official-card:2026-10-25:京都:11:official-program');return{ok:true,status:'official-card-saved',externalRequests:1};}});
 assert.deepEqual(r.target,{date:kikkaDate,venue:'京都',raceNo:11});assert.equal(calls,1);sql.close();
});
test('natural witnessed card still obeys shared wait and receipt wait and permits other cards while waiting',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-22T09:00:00Z');
 for(const [day,venue] of [['2026-10-24','東京'],[kikkaDate,'京都']])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,11,'15:40','https://www.jra.go.jp/calendar');
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');sql.prepare('INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at) VALUES(?,?)').run('official-card:2026-10-25:京都:11:official-program',stamp+3600000);
 const input={date:'2026-10-22',includeFuture:true,upcomingOnly:true};let calls=0;
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=?').run(stamp+3600000);
 assert.equal((await collectMissingOfficialCard(db,input,{now:()=>stamp,discover:async()=>{calls++;assert.fail('blocked gate');}})).status,'cooldown');assert.equal(calls,0);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();
 const r=await collectMissingOfficialCard(db,input,{now:()=>stamp,discover:async(_,s)=>{calls++;assert.equal(s.date,'2026-10-24');assert.equal(s.venue,'東京');assert.equal(s.officialCardUrl,undefined);return{ok:true,externalRequests:1};}});assert.equal(r.target.venue,'東京');assert.equal(calls,1);sql.close();
});
test('witnessed future card never displaces an urgent race or refetches a complete card',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-22T00:00:00Z');
 for(const [day,venue] of [['2026-10-22','東京'],[kikkaDate,'京都']])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,11,'15:40','https://www.jra.go.jp/calendar');
 let target;const deps={now:()=>stamp,discover:async(_,s)=>{target=s;return{ok:true,externalRequests:1};}};
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(target.date,'2026-10-22');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('saved',kikkaDate,'京都',11,1,kikkaCard);sql.prepare('INSERT INTO jra_runners VALUES(?)').run('saved');
 await collectMissingOfficialCard(db,{date:'2026-10-22',includeFuture:true,upcomingOnly:true},deps);assert.equal(target.date,'2026-10-22');sql.close();
});
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
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');sql.prepare('INSERT INTO lab_expected_card_discovery(snapshot_id,next_attempt_at) VALUES(?,?)').run('official-card:'+kikkaDate+':京都:11:official-program',now+3600000);
 assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'card-discovery-not-due');
 sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run('saved',kikkaDate,'京都',11,1,kikkaCard);sql.prepare('INSERT INTO jra_runners VALUES(?)').run('saved');assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'complete');sql.close();
});

test('a discovered due card completes before another calendar scan, then a failed attempt yields to untried cards',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T02:30:00Z');
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const [day,venue,no] of [['2026-10-24','東京',1],['2026-10-25','京都',9]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,no,'15:00','https://www.jra.go.jp/calendar');
 const id='official-card:2026-10-25:京都:9:official-program',url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604090920261025/8F';
 sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(id,stamp-1,url,'official-card-link-found');
 const visited=[];const deps={now:()=>stamp,discover:async(_,source)=>{visited.push(source);sql.prepare('UPDATE lab_expected_card_discovery SET status=? WHERE snapshot_id=?').run('failed',source.snapshotId);return{ok:false,status:'failed',externalRequests:1};}};
 await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},deps);
 assert.equal(visited[0].raceNo,9);assert.equal(visited[0].venue,'京都');
 await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},deps);assert.equal(visited[1].venue,'東京');sql.close();
});
test('discovered cards respect individual wait and urgent Saturday cards',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-24T00:00:00Z');
 sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const [day,venue,no] of [['2026-10-24','東京',1],['2026-10-25','京都',9]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,no,'15:00','https://www.jra.go.jp/calendar');
 sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-25:京都:9:official-program',stamp+1,card,'official-card-link-found');
 const result=await collectMissingOfficialCard(db,{date:'2026-10-24',includeFuture:true,upcomingOnly:true},{now:()=>stamp,discover:async(_,s)=>{assert.equal(s.date,'2026-10-24');return{ok:true,externalRequests:1}}});assert.equal(result.target.venue,'東京');sql.prepare('UPDATE lab_expected_card_discovery SET next_attempt_at=?').run(stamp-1);const urgent=await collectMissingOfficialCard(db,{date:'2026-10-24',includeFuture:true,upcomingOnly:true},{now:()=>stamp,discover:async(_,s)=>{assert.equal(s.date,'2026-10-24');return{ok:true,externalRequests:1}}});assert.equal(urgent.target.venue,'東京');sql.close();
});
test('published index receipt progresses through the same queue before an unrelated untried calendar',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T03:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const [venue,no] of [['東京',1],['京都',2]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24',venue,no,'10:00','https://www.jra.go.jp/calendar');
 sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:京都:2:official-program',stamp-1,'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3','official-card-index-found');
 const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>stamp,discover:async(_,s)=>{assert.equal(s.venue,'京都');return{ok:true,status:'official-card-link-found',externalRequests:1}}});assert.equal(r.target.raceNo,2);sql.close();
});
test('Saturday discovery receives a slot after Sunday card completion even with many ready Sunday links',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T04:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',1,'10:05','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:東京:1:official-program',stamp-1,null,'failed');
 for(let no=1;no<=12;no++){sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-25','京都',no,'15:00','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(`official-card:2026-10-25:京都:${no}:official-program`,stamp-1,`https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde010820260409${String(no).padStart(2,'0')}20261025/AA`,'official-card-link-found');}
 let previous={lane:'card'};const visited=[];for(let i=0;i<4;i++){const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>stamp,previousCardSelection:previous,discover:async(_,s)=>{visited.push(s.date);return{ok:true,status:'failed',externalRequests:1}}});previous=r.cardSelection;}
 assert.deepEqual(visited,['2026-10-24','2026-10-25','2026-10-24','2026-10-25']);sql.close();
});
test('fair selection never overrides shared lease or a discovery receipt waiting after HTTP403',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T04:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',1,'10:05','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:東京:1:official-program',stamp+3600000,null,'failed');
 const deps={now:()=>stamp,previousCardSelection:{lane:'card'},discover:()=>assert.fail('blocked')},input={date:'2026-10-23',includeFuture:true,upcomingOnly:true};assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'card-discovery-not-due');sql.prepare('UPDATE lab_history_collection_budget SET locked_until=?').run(stamp+120000);assert.equal((await collectMissingOfficialCard(db,input,deps)).status,'cooldown');sql.close();
});

test('ready card receives its turn after discovery even when many linked index pages remain',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T04:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(let no=1;no<=12;no++){sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',no,'15:00','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(`official-card:2026-10-24:東京:${no}:official-program`,stamp-1,'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3','official-card-index-found');}
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-25','京都',9,'15:00','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-25:京都:9:official-program',stamp-1,'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604090920261025/AA','official-card-link-found');
 const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>stamp,previousCardSelection:{lane:'discovery'},discover:async()=>({ok:true,externalRequests:1})});assert.equal(r.target.date,'2026-10-25');assert.equal(r.cardSelection.lane,'card');sql.close();
});
test('fair Saturday selection reaches the existing one-page published-index discovery and receipt writer',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T04:00:00Z');sql.exec("DROP TABLE lab_history_collection_budget;CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER DEFAULT 0,lock_token TEXT);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0,NULL)");sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',1,'10:05','https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html');
 let requests=0;const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>stamp,previousCardSelection:{lane:'card'},fetcher:async()=>{requests++;return new Response('<a href="/JRADB/accessD.html?CNAME=pw01dli00/F3">出馬表</a>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(requests,1);assert.equal(r.status,'official-card-index-found');assert.equal(r.cardSelection.lane,'discovery');assert.equal(r.officialCardsCreated,false);const receipt=sql.prepare('SELECT * FROM lab_expected_card_discovery').get();assert.equal(receipt.snapshot_id,'official-card:2026-10-24:東京:1:official-program');assert.equal(receipt.next_attempt_at,stamp+60000);assert.equal(receipt.status,r.status);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);sql.close();
});

test('due discovery retries and untried races both receive slots across all 72 weekend races',async()=>{
 const {sql,db}=fixture();sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');let stamp=Date.parse('2026-10-29T05:00:00Z');
 for(const day of ['2026-10-31','2026-11-01'])for(const venue of ['東京','京都','新潟'])for(let no=1;no<=12;no++){sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,no,'10:00','https://www.jra.go.jp/calendar');if(day==='2026-10-31')sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(`official-card:${day}:${venue}:${no}:official-program`,stamp-86400000,null,'failed');}
 let previous={lane:'discovery',lastDiscoveryClass:'untried'};const seen=[];
 for(let i=0;i<72;i++){const r=await collectMissingOfficialCard(db,{date:'2026-10-29',includeFuture:true,upcomingOnly:true},{now:()=>stamp,previousCardSelection:previous,discover:async(_,s)=>{seen.push(s.snapshotId);sql.prepare('INSERT OR REPLACE INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(s.snapshotId,stamp+3600000,null,'failed');return{ok:false,status:'failed',externalRequests:1}}});previous=r.cardSelection;stamp+=18*60000;}
 assert.equal(new Set(seen).size,72);assert.match(seen[0],/2026-10-31/);assert.match(seen[1],/2026-11-01/);assert.deepEqual(seen.slice(0,6).map(x=>x.includes('2026-10-31')), [true,false,true,false,true,false]);sql.close();
});
test('discovery retry fairness survives an intervening card slot and excludes blocked receipts',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-23T06:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const [day,venue,no] of [['2026-10-24','東京',1],['2026-10-24','新潟',1],['2026-10-25','京都',4],['2026-10-25','京都',5]])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(day,venue,no,'15:00','https://www.jra.go.jp/calendar');
 sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:東京:1:official-program',stamp-1,null,'failed');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:新潟:1:official-program',stamp+3600000,null,'failed');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-25:京都:5:official-program',stamp-1,'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604090520261025/AA','official-card-link-found');
 const input={date:'2026-10-23',includeFuture:true,upcomingOnly:true},discover=async()=>({ok:true,externalRequests:1});
 const card=await collectMissingOfficialCard(db,input,{now:()=>stamp,previousCardSelection:{lane:'discovery',lastDiscoveryClass:'untried'},discover});assert.equal(card.cardSelection.lane,'card');assert.equal(card.cardSelection.lastDiscoveryClass,'untried');
 const retry=await collectMissingOfficialCard(db,input,{now:()=>stamp,previousCardSelection:card.cardSelection,discover});assert.deepEqual(retry.target,{date:'2026-10-24',venue:'東京',raceNo:1});assert.equal(retry.cardSelection.lastDiscoveryClass,'retry');sql.close();
});
test('discovery class fairness does not replace urgent selection, and waiting shared gate consumes no turn',async()=>{
 const {sql,db}=fixture(),stamp=Date.parse('2026-10-24T01:00:00Z');sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');
 for(const venue of ['東京','京都'])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24',venue,1,'10:05','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-25','新潟',11,'15:00','https://www.jra.go.jp/calendar');sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run('official-card:2026-10-24:京都:1:official-program',stamp-1,null,'failed');
 let requests=0,queries=0;const tracked={prepare(q){queries++;return db.prepare(q)}},previous={lane:'card',lastDiscoveryClass:'untried'},deps={now:()=>stamp,previousCardSelection:previous,discover:async()=>{requests++;return{ok:true,externalRequests:1}}},input={date:'2026-10-24',includeFuture:true,upcomingOnly:true};
 const result=await collectMissingOfficialCard(tracked,input,deps);assert.equal(result.target.venue,'東京');assert.equal(result.cardSelection.reason,'urgent');assert.equal(queries,4);assert.equal(requests,1);
 sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=?,locked_until=?').run(stamp+3600000,stamp+120000);queries=0;const blocked=await collectMissingOfficialCard(tracked,input,deps);assert.equal(blocked.status,'cooldown');assert.equal(blocked.cardSelection,undefined);assert.equal(queries,1);assert.equal(requests,1);sql.close();
});

const publishedIndex='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00%2FF3';
function continuationFixture(){const f=fixture(),stamp=Date.parse('2026-10-23T07:54:49Z');f.sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');for(const venue of ['東京','京都','新潟'])for(let no=1;no<=12;no++){const id=`official-card:2026-10-24:${venue}:${no}:official-program`,hasIndex=no===(venue==='京都'?12:11);f.sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24',venue,no,'15:00','https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html');f.sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(id,stamp-(hasIndex?(venue==='東京'?7200000:venue==='京都'?3600000:60000):86400000),hasIndex?publishedIndex:null,hasIndex?'official-card-index-found':'failed');}return{...f,stamp};}
test('index continuation and undiscovered retries alternate without starving either direction',async()=>{
 const {sql,db,stamp}=continuationFixture();let time=stamp,previous={lane:'card',lastDiscoveryClass:'untried'},queries=0;const stages=[],continued=[];const tracked={prepare(q){queries++;return db.prepare(q)}};
 for(let i=0;i<6;i++){const r=await collectMissingOfficialCard(tracked,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>time,previousCardSelection:previous,discover:async(_,s)=>{const row=sql.prepare('SELECT card_url FROM lab_expected_card_discovery WHERE snapshot_id=?').get(s.snapshotId),stage=row.card_url?'continuation':'reexploration';stages.push(stage);if(row.card_url)continued.push(s.snapshotId);sql.prepare('UPDATE lab_expected_card_discovery SET next_attempt_at=? WHERE snapshot_id=?').run(time+3600000,s.snapshotId);return{ok:false,status:'failed',externalRequests:1}}});if(i===0)assert.equal(stages[0],'continuation');assert.equal(r.cardSelection.retryDiscoveryStage,stages.at(-1));previous=r.cardSelection;time+=18*60000;}
 assert.deepEqual(stages,['continuation','reexploration','continuation','reexploration','continuation','reexploration']);assert.equal(new Set(continued).size,3);assert.equal(queries,24);sql.close();
});
test('retry continuation cursor survives untried discovery and direct-card turns',async()=>{
 const {sql,db,stamp}=continuationFixture(),input={date:'2026-10-23',includeFuture:true,upcomingOnly:true};
 for(const no of [1,2])sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-25','京都',no,'15:00','https://www.jra.go.jp/calendar');const cardId='official-card:2026-10-25:京都:2:official-program';sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(cardId,stamp-1,'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604090220261025/AA','official-card-link-found');
 const deps={now:()=>stamp,previousCardSelection:{lane:'discovery',lastDiscoveryClass:'retry',lastRetryDiscoveryStage:'continuation'},discover:async()=>({ok:true,externalRequests:1})};
 const card=await collectMissingOfficialCard(db,input,deps);assert.equal(card.cardSelection.lane,'card');assert.equal(card.cardSelection.lastRetryDiscoveryStage,'continuation');sql.prepare('UPDATE lab_expected_card_discovery SET next_attempt_at=? WHERE snapshot_id=?').run(stamp+3600000,cardId);
 deps.previousCardSelection=card.cardSelection;const fresh=await collectMissingOfficialCard(db,input,deps);assert.equal(fresh.target.date,'2026-10-25');assert.equal(fresh.cardSelection.discoveryClass,'untried');assert.equal(fresh.cardSelection.lastRetryDiscoveryStage,'continuation');
 deps.previousCardSelection=fresh.cardSelection;const retry=await collectMissingOfficialCard(db,input,deps);assert.equal(retry.cardSelection.retryDiscoveryStage,'reexploration');sql.close();
});
test('continuation preference respects receipt403 wait and shared lease without consuming a turn',async()=>{
 const {sql,db,stamp}=continuationFixture();sql.prepare('UPDATE lab_expected_card_discovery SET next_attempt_at=? WHERE card_url IS NOT NULL').run(stamp+3600000);const deps={now:()=>stamp,previousCardSelection:{lane:'card',lastDiscoveryClass:'untried'},discover:async(_,s)=>{assert.equal(sql.prepare('SELECT card_url FROM lab_expected_card_discovery WHERE snapshot_id=?').get(s.snapshotId).card_url,null);return{ok:true,externalRequests:1}}};
 const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},deps);assert.equal(r.cardSelection.retryDiscoveryStage,'reexploration');sql.prepare('UPDATE lab_history_collection_budget SET locked_until=?').run(stamp+120000);const blocked=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true}, {...deps,discover:()=>assert.fail('lease held')});assert.equal(blocked.status,'cooldown');assert.equal(blocked.cardSelection,undefined);sql.close();
});
test('continuation selection reaches existing index parser and saves only exact individual URL in one request',async()=>{
 const {sql,db,stamp}=continuationFixture();sql.exec("DROP TABLE lab_history_collection_budget;CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER DEFAULT 0,lock_token TEXT);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0,NULL)");sql.exec('DROP TABLE lab_expected_card_discovery;CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,card_url TEXT,next_attempt_at INTEGER,status TEXT,error TEXT)');
 for(const row of sql.prepare('SELECT * FROM jra_race_program').all()){const indexed=row.race_no===(row.venue==='京都'?12:11);sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?,?)').run(`official-card:2026-10-24:${row.venue}:${row.race_no}:official-program`,indexed?publishedIndex:null,stamp-(indexed?(row.venue==='東京'?7200000:row.venue==='京都'?3600000:60000):86400000),indexed?'official-card-index-found':'failed',null);}
 const url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604081120261024/AA';let requests=0;
 const r=await collectMissingOfficialCard(db,{date:'2026-10-23',includeFuture:true,upcomingOnly:true},{now:()=>stamp,previousCardSelection:{lane:'card',lastDiscoveryClass:'untried'},fetcher:async(request,options)=>{requests++;assert.equal(request,'https://www.jra.go.jp/JRADB/accessD.html');assert.equal(new URLSearchParams(options.body).get('CNAME'),'pw01dli00/F3');return new Response(`<a href="${url.replace('20261024','20261025')}">wrong date</a><a href="${url.replace('dde0105','dde0108')}">wrong venue</a><a href="${url.replace('08112026','08122026')}">wrong race</a><a href="${url}">correct</a>`,{headers:{'content-type':'text/html;charset=utf-8'}})}});
 assert.equal(requests,1);assert.equal(r.status,'official-card-link-found');assert.deepEqual(r.target,{date:'2026-10-24',venue:'東京',raceNo:11});assert.equal(r.cardSelection.retryDiscoveryStage,'continuation');assert.equal(r.officialCardsCreated,false);assert.equal(sql.prepare("SELECT card_url FROM lab_expected_card_discovery WHERE snapshot_id='official-card:2026-10-24:東京:11:official-program'").get().card_url,url);assert.equal(sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n,0);sql.close();
});

function urgentFixture(){const f=fixture();f.sql.exec('CREATE TABLE lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,next_attempt_at INTEGER,card_url TEXT,status TEXT)');return f;}
const urgentStamp=Date.parse('2026-10-24T00:00:00Z');
const urgentLink=no=>`https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde010520260408${String(no).padStart(2,'0')}20261024/AA`;
function urgentRace(sql,no,time,receipt=null){sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run('2026-10-24','東京',no,time,'https://www.jra.go.jp/keiba/calendar2026/2026/10/1024.html');if(receipt)sql.prepare('INSERT INTO lab_expected_card_discovery VALUES(?,?,?,?)').run(`official-card:2026-10-24:東京:${no}:official-program`,receipt.next,receipt.url,receipt.status);}
test('urgent deadline order survives older retry timestamps inside the selected card cohort',async()=>{
 const {sql,db}=urgentFixture();urgentRace(sql,1,'10:00',{next:urgentStamp-1,url:urgentLink(1),status:'failed'});urgentRace(sql,11,'15:00',{next:urgentStamp-3600000,url:urgentLink(11),status:'failed'});
 const r=await collectMissingOfficialCard(db,{date:'2026-10-24',upcomingOnly:true},{now:()=>urgentStamp,previousCardSelection:{lane:'discovery'},discover:async()=>({ok:true,externalRequests:1})});assert.equal(r.target.raceNo,1);sql.close();
});
test('urgent deadline order cannot be replaced by a later linked-index preference',async()=>{
 const {sql,db}=urgentFixture();urgentRace(sql,1,'10:00');urgentRace(sql,11,'15:00',{next:urgentStamp-1,url:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3',status:'official-card-index-found'});
 const r=await collectMissingOfficialCard(db,{date:'2026-10-24',upcomingOnly:true},{now:()=>urgentStamp,previousCardSelection:{lane:'card'},discover:async()=>({ok:true,externalRequests:1})});assert.equal(r.target.raceNo,1);sql.close();
});
test('urgent earlier due discovery is not displaced by a later untried race',async()=>{
 const {sql,db}=urgentFixture();urgentRace(sql,1,'10:00',{next:urgentStamp-1,url:null,status:'failed'});urgentRace(sql,11,'15:00');
 const r=await collectMissingOfficialCard(db,{date:'2026-10-24',upcomingOnly:true},{now:()=>urgentStamp,previousCardSelection:{lane:'card'},discover:async()=>({ok:true,externalRequests:1})});assert.equal(r.target.raceNo,1);sql.close();
});
test('urgent deadline selection still alternates card and discovery lanes and excludes waiting receipts',async()=>{
 const {sql,db}=urgentFixture();urgentRace(sql,1,'10:00',{next:urgentStamp-1,url:urgentLink(1),status:'official-card-link-found'});urgentRace(sql,2,'10:30');urgentRace(sql,3,'09:30',{next:urgentStamp+3600000,url:urgentLink(3),status:'failed'});
 const input={date:'2026-10-24',upcomingOnly:true},deps={now:()=>urgentStamp,discover:async()=>({ok:true,externalRequests:1})};
 const a=await collectMissingOfficialCard(db,input,{...deps,previousCardSelection:{lane:'card'}}),b=await collectMissingOfficialCard(db,input,{...deps,previousCardSelection:a.cardSelection});assert.equal(a.target.raceNo,2);assert.equal(b.target.raceNo,1);sql.close();
});
