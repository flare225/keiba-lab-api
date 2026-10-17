import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {upcomingOfficialHistoryPlan,collectUpcomingOfficialHistory} from '../src/upcoming-official-history.js';
const stamp=Date.parse('2026-10-17T13:30:00+09:00');
test('rolling plan includes ordinary and tomorrow cards, excludes past/post-time/incomplete cards and target-day history',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER,race_name TEXT,runner_count INTEGER);
 CREATE TABLE jra_runners(race_key TEXT,horse_name TEXT,age INTEGER);
 CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);
 CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,finish_position INTEGER,field_size INTEGER);`);
 const add=(key,date,no,time,count=1)=>{sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?,?,?)').run(key,date,'東京',no,key,count);sql.prepare('INSERT INTO jra_runners VALUES(?,?,?)').run(key,key,3);if(time)sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,'東京',no,time,'https://www.jra.go.jp/program');};
 add('past','2026-10-16',11,'15:45');add('finished','2026-10-17',1,'10:00');add('ordinary','2026-10-17',9,'14:30');add('main','2026-10-17',11,'15:45');add('tomorrow','2026-10-18',3,null);add('incomplete','2026-10-18',4,null,2);add('far','2026-10-25',11,null);add('covered','2026-10-18',5,null);
 sql.prepare('INSERT INTO jra_past_performances VALUES(?,?,?,?)').run('covered','2026-10-01',2,12);
 sql.prepare('INSERT INTO jra_past_performances VALUES(?,?,?,?)').run('ordinary','2026-10-17',1,12);
 const db={prepare(q){const s=sql.prepare(q);return{bind(...v){return{async all(){return{results:s.all(...v)}}}}}}};
 const plan=await upcomingOfficialHistoryPlan(db,stamp,[{raceKey:'main',priority:0}]);
 assert.deepEqual(plan.map(r=>r.raceKey),['main','ordinary','tomorrow']);assert.equal(plan[1].missingHorses,1);
 sql.close();
});
test('one shared collection call only, cooldown cannot fall through to another race',async()=>{
 let calls=0;
 const race={raceKey:'tomorrow',date:'2026-10-18',venue:'京都',raceNo:11};
 const result=await collectUpcomingOfficialHistory({}, {now:()=>stamp,plan:async()=>[race,{...race,raceNo:10}],status:async()=>({runners:[{storedRows:0,due:true,profileUrl:'https://www.jra.go.jp/profile'}]}),collect:async(_,input)=>{calls++;assert.equal(input.batchSize,1);assert.equal(input.historyLimit,10);return{status:'cooldown',externalRequests:0}}});
 assert.equal(calls,1);assert.equal(result.status,'cooldown');assert.equal(result.priorityRaceKey,'tomorrow');
});
test('complete or not-due horses never trigger an external collection',async()=>{
 const race={date:'2026-10-18',venue:'京都',raceNo:11};
 for(const runner of [{storedRows:3,due:true,profileUrl:'known'},{storedRows:0,due:false,profileUrl:'known'}])assert.equal(await collectUpcomingOfficialHistory({}, {now:()=>stamp,plan:async()=>[race],status:async()=>({runners:[runner]}),collect:async()=>assert.fail('unexpected acquisition')}),null);
});
test('unresolved early cards cannot starve later ordinary races and status reads stay bounded',async()=>{
 const queue=Array.from({length:12},(_,i)=>({raceKey:String(i),date:'2026-10-18',venue:'京都',raceNo:i+1}));
 let acquired=false;
 for(let slot=0;slot<12&&!acquired;slot++){
  let reads=0;
  await collectUpcomingOfficialHistory({}, {now:()=>stamp+slot*360000,plan:async()=>queue,status:async(_,input)=>{reads++;return{runners:[{storedRows:0,due:true,profileUrl:input.raceNo===12?'known':null}]}},collect:async()=>{acquired=true;return{externalRequests:1}}});
  assert.ok(reads<=6);
 }
 assert.equal(acquired,true);
});
