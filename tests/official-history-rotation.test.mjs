import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUpcomingOfficialHistory} from '../src/upcoming-official-history.js';

for(const gap of [18,36])test(`saved-card rotation reaches every remaining card at real ${gap}-minute history opportunities`,async()=>{
 const start=Date.parse('2026-11-06T16:00:00+09:00');
 const queue=Array.from({length:16},(_,i)=>({raceKey:`2026-11-07:場${i}:11`,date:'2026-11-07',venue:`場${i}`,raceNo:11}));
 const saved=new Set(),rotationState={cursor:0};
 for(let turn=0;turn<18;turn++){
  let reads=0;
  await collectUpcomingOfficialHistory({}, {now:()=>start+turn*gap*60000,plan:async()=>queue,rotationState,
   status:async(_,input)=>{reads++;return{runners:[{storedRows:0,due:input.venue!=='場0'&&!saved.has(input.venue)}]};},
   collect:async(_,input)=>{saved.add(input.venue);return{status:'collected',attempted:1,externalRequests:0};}});
  assert.ok(reads<=6,'existing six-card read bound');
 }
 assert.equal(saved.size,15,'no ready saved card can remain outside the sampled window forever');
});


test('real dispatcher persists bounded rotation through acquisition, safety cooldown and idle windows',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {dispatchLiveSources,collectLiveHistory}=await import('../src/live-source-dispatch.js');
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0)");
 const db={prepare(q){const wrap=(args=[])=>({bind(...v){return wrap(v)},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:r.changes}}}});return wrap()}};
 let stamp=Date.parse('2026-11-06T12:00:00+09:00'),turn=0,reads=0;const saved=new Set(),seen=[];
 const queue=Array.from({length:16},(_,i)=>({raceKey:`2026-11-07:場${i}:11`,date:'2026-11-07',venue:`場${i}`,raceNo:11}));
 const idle=async()=>({ok:true,status:'idle',externalRequests:0});
 const history=async(measured,event,options)=>{
  seen.push(options.previousOfficialHistoryCursor);turn++;
  if(turn===3)return{status:'official-card-saved',externalRequests:1,historyWorkStage:'acquisition',cardSelection:{lane:'card'}};
  sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=? WHERE name='jra-history'").run(turn===4?stamp+3600000:0);
  reads=0;
  const result=await collectLiveHistory(measured,event,{...options,previousHistoryWorkStage:'acquisition',
   upcoming:(d,input)=>collectUpcomingOfficialHistory(d,{...input,plan:async()=>queue,
    status:async(_,input)=>{reads++;return{runners:[{storedRows:0,due:input.venue!=='場0'&&!saved.has(input.venue)}]};},
    collect:async(_,input)=>{saved.add(input.venue);return{status:'collected',attempted:1,externalRequests:0};}}),
   registered:async()=>[],cards:idle,missing:async()=>null,programs:idle,main:async()=>null,expected:idle,details:idle});
  assert.ok(reads<=6);
  if(turn===4){assert.equal(result.status,'cooldown');assert.equal(reads,0);assert.equal(result.officialHistoryCursor,options.previousOfficialHistoryCursor);}
  return result;
 };
 for(let i=0;i<63;i++){await dispatchLiveSources({cron:'*/3 * * * *',scheduledTime:stamp},{DB:db},{now:()=>stamp,archive:idle,results:idle,history});stamp+=6*60000;}
 assert.deepEqual(seen.slice(0,6),[0,5,10,10,10,0]);
 assert.equal(saved.size,15);
 assert.equal(turn,21);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_bounded_pipeline_runs WHERE job='results'").get().n,21);
 const last=JSON.parse(sql.prepare("SELECT result_json FROM lab_bounded_pipeline_runs WHERE job='history' ORDER BY started_at DESC LIMIT 1").get().result_json);
 assert.equal(last.officialHistoryCursor,5,'no-due windows also persist progress');
 sql.close();
});
