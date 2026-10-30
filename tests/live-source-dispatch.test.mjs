import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {dispatchLiveSources,collectLiveHistory,preferOfficialCards,cardCompletionPriorities} from '../src/live-source-dispatch.js';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes}}}});return w()}};return{sql,db}}
const start=Date.parse('2026-10-19T00:12:00Z');
test('an exhausted predraw handoff falls back once and does not repeat the known-profile scan next turn',async()=>{
 let scans=0,cards=0;const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 const deps={now:()=>start,cardCompletionFirst:true,priorityExpected:async()=>{scans++;return{status:'idle',externalRequests:0}},cards:async()=>{cards++;return{status:'official-card-link-found',externalRequests:1}}};
 let selection={lane:'card',savedPredrawHistoryPending:true};
 for(let i=0;i<2;i++){const r=await collectLiveHistory(db,{scheduledTime:start+i*60000},{...deps,previousHistoryWorkStage:'acquisition',previousCardSelection:selection});selection=r.cardSelection||selection;}
 assert.equal(scans,1);assert.equal(cards,2);assert.equal(selection.savedPredrawHistoryPending,false);
});
test('pending predraw history cannot bypass shared cooldown or a collector safety stop',async()=>{
 const stamp=start,selection={lane:'card',savedPredrawHistoryPending:true};
 for(const blocked of [true,false]){
  let called=0;const db={prepare(){return{async first(){return{next_batch_at:blocked?stamp+3600000:0,locked_until:0}}}}};
  const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:selection,
   priorityExpected:async(_,deps)=>{called++;assert.equal(deps.knownProfilesOnly,true);return{status:'paused',externalRequests:0}},cards:()=>assert.fail('no fallback on safety stop')});
  assert.equal(r.status,blocked?'cooldown':'paused');assert.equal(called,blocked?0:1);assert.equal(r.cardSelection,undefined);
 }
});
test('after acquisition an existing roster gets its history turn before unrelated calendar recovery',async()=>{
 const stamp=Date.parse('2026-10-28T00:54:49Z'),calls=[];
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,previousHistoryWorkStage:'acquisition',cardCompletionFirst:true,cards:async()=>({status:'awaiting-official-publication',externalRequests:0}),missing:async()=>({status:'source-not-due',externalRequests:0}),registered:async()=>[{date:'2026-11-01'}],expected:async()=>{calls.push('saved-roster-history');return{status:'collected',attempted:1,externalRequests:1}},programs:async()=>{calls.push('unrelated-calendar');return{status:'source-unconfirmed',externalRequests:1,error:'JRA program HTTP 403'}}});
 assert.deepEqual(calls,['saved-roster-history']);assert.equal(r.historyWorkStage,'history');assert.equal(r.externalRequests,1);
});
test('calendar recovery retains its turn after a history batch while acquisition cooldown cannot fall through',async()=>{
 const stamp=Date.parse('2026-10-28T00:54:49Z');
 for(const stage of ['history','acquisition']){const calls=[];const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,previousHistoryWorkStage:stage,cardCompletionFirst:true,cards:async()=>({status:'awaiting-official-publication',externalRequests:0}),missing:async()=>null,registered:async()=>[{date:'2026-11-01'}],expected:async()=>{calls.push('history');return{status:'cooldown',externalRequests:0}},programs:async()=>{calls.push('program');return{status:'verified-published-program',externalRequests:1}}});assert.deepEqual(calls,stage==='history'?['program']:['history']);assert.equal(r.externalRequests,stage==='history'?1:0);}
});
test('before publication card discovery yields to program recovery and existing roster history preparation',async()=>{
 const stamp=Date.parse('2026-10-26T00:00:00Z');
 for(const stage of ['program','program-cached','history']){
  const calls=[];const result=await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,cards:async(_,input)=>{calls.push(input.publicationWindowOnly?'publication-plan':'card-request');return input.publicationWindowOnly?{status:'awaiting-official-publication',externalRequests:0}:{status:'page-parsed',externalRequests:1}},missing:async()=>({status:'no-work',externalRequests:0}),registered:async()=>[{date:'2026-10-31'}],programs:async()=>stage==='history'?null:(calls.push(stage),{status:'verified-published-program',externalRequests:stage==='program'?1:0,...(stage==='program-cached'?{programRowsSaved:24,readbackVerified:24}:{})}),expected:async()=>{calls.push('history');return{status:'collected',externalRequests:1}}});
  assert.deepEqual(calls,['publication-plan',stage]);assert.equal(result.externalRequests,stage==='program-cached'?0:1);if(stage==='program-cached')assert.equal(result.historyWorkStage,'acquisition');
 }
 const cached=await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,cards:async(_,input)=>input.publicationWindowOnly?{status:'awaiting-official-publication',externalRequests:0}:{status:'page-parsed',externalRequests:0,attempted:true,reusedBody:true},missing:async()=>null,registered:async()=>[],programs:async()=>null,main:()=>assert.fail('cached acquisition must not fall through'),expected:()=>assert.fail('one completed stage only')});assert.equal(cached.status,'page-parsed');assert.equal(cached.historyWorkStage,'acquisition');
});
test('live dispatcher cannot starve results when card/history queue never empties',async()=>{
 const {sql,db}=fixture();let stamp=start;const seen=[];
 const deps={now:()=>stamp,archive:async()=>{seen.push('archive');return{ok:true,status:'idle',externalRequests:0}},results:async()=>{seen.push('results');return{ok:true,status:'collected',externalRequests:1}},history:async()=>{seen.push('history');return{ok:true,status:'cooldown',externalRequests:0}}};
 for(let i=0;i<6;i++){await dispatchLiveSources({cron:'*/3 * * * *',scheduledTime:stamp},{DB:db},deps);stamp+=360000;}
 assert.deepEqual(seen,['archive','results','history','archive','results','history']);assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_bounded_pipeline_runs WHERE job='results'").get().n,2);sql.close();
});
test('history priorities stop at shared cooldown without calling another source',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{missing:async()=>null,programs:async()=>null,registered:async()=>[],cards:async()=>({status:'cooldown',externalRequests:0}),main:()=>assert.fail('must stop'),upcoming:()=>assert.fail('must stop'),expected:()=>assert.fail('must stop'),details:()=>assert.fail('must stop')});assert.equal(r.status,'cooldown');
});
test('ordinary card priority lives inside history lane and requests the coming week',async()=>{
 let called=false;const r=await collectLiveHistory({}, {scheduledTime:start},{missing:async()=>null,programs:async()=>null,registered:async()=>[],cards:async(_,input)=>{assert.equal(input.includeFuture,true);assert.equal(input.upcomingOnly,true);called=true;return{status:'official-card-saved',externalRequests:1}},main:()=>assert.fail('one source batch only')});assert.equal(called,true);assert.equal(r.externalRequests,1);
});
test('idle history can enrich prior details without running a second source batch',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{missing:async()=>null,programs:async()=>null,registered:async()=>[],cards:async()=>({status:'complete',externalRequests:0}),main:async()=>null,upcoming:async()=>null,expected:async()=>({status:'idle',externalRequests:0}),details:async(_,deps)=>{assert.equal(typeof deps.now,'function');return{status:'collected',externalRequests:1}}});assert.equal(r.externalRequests,1);
});

test('saved upcoming registration history is attempted before unpublished card discovery',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:start},{missing:async()=>null,programs:async()=>null,registered:async()=>[{names:['A']}],expected:async()=>({status:'collected',attempted:1,externalRequests:1}),cards:()=>assert.fail('roster history must not wait for a numbered card')});assert.equal(r.externalRequests,1);
});

test('published-card priority cannot be starved by a busy registered history queue',async()=>{
 const rosters=[{date:'2026-10-24',venue:'東京',raceNo:9},{date:'2026-10-25',venue:'京都',raceNo:11}];
 assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-20T04:00:00Z')),false);assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-22T04:59:59Z')),false);assert.equal(preferOfficialCards(rosters,Date.parse('2026-10-22T05:00:00Z')),true);
 const r=await collectLiveHistory({}, {scheduledTime:Date.parse('2026-10-22T05:00:00Z')},{missing:async()=>null,programs:async()=>null,now:()=>Date.parse('2026-10-22T05:00:00Z'),registered:async()=>rosters,cards:async()=>({status:'official-card-saved',externalRequests:1}),expected:()=>assert.fail('ready cards take priority over pending histories'),main:()=>assert.fail('one external batch only')});assert.equal(r.externalRequests,1);
});
test('card cooldown in publication window cannot fall through to a second source request',async()=>{
 const r=await collectLiveHistory({}, {scheduledTime:0},{missing:async()=>null,programs:async()=>null,now:()=>Date.parse('2026-10-23T04:00:00Z'),registered:async()=>[{date:'2026-10-24'}],cards:async()=>({status:'cooldown',externalRequests:0}),expected:()=>assert.fail('respect shared gate')});assert.equal(r.status,'cooldown');
});
test('program recovery uses only its source slot and other history work resumes on the next invocation',async()=>{
 let first=true,cards=0;const deps={missing:async()=>null,programs:async()=>first?(first=false,{ok:false,status:'source-unconfirmed',externalRequests:1}):null,registered:async()=>[],cards:async()=>{cards++;return{ok:true,status:'official-card-saved',externalRequests:1}}};
 const a=await collectLiveHistory({}, {scheduledTime:start},deps);assert.equal(a.status,'source-unconfirmed');assert.equal(cards,0);const b=await collectLiveHistory({}, {scheduledTime:start+3600000},deps);assert.equal(b.status,'official-card-saved');assert.equal(cards,1);
});
test('supplementary roster uses a later history slot instead of being stranded at the hourly gate',async()=>{let calls=0;const deps={now:()=>start,programs:async()=>null,missing:async()=>({status:++calls===1?'cooldown':'roster-saved',externalRequests:calls===1?0:1}),registered:()=>assert.fail('one source only')};assert.equal((await collectLiveHistory({}, {scheduledTime:start},deps)).status,'cooldown');assert.equal((await collectLiveHistory({}, {scheduledTime:start+360000},deps)).status,'roster-saved');});

const published=Date.parse('2026-10-22T06:12:50Z');
const publishedRosters=[{date:'2026-10-25',venue:'京都',raceNo:11}];
test('publication-window card work precedes an unrelated due calendar fetch',async()=>{
 const calls=[];const r=await collectLiveHistory({}, {scheduledTime:published},{now:()=>published,missing:async()=>({status:'official-card-priority',externalRequests:0}),registered:async()=>publishedRosters,programs:async()=>{calls.push('program-403');return{ok:false,status:'source-unconfirmed',externalRequests:1,error:'JRA program HTTP 403'}},cards:async()=>{calls.push('card');return{ok:true,status:'official-card-saved',externalRequests:1}}});
 assert.equal(r.status,'official-card-saved');assert.deepEqual(calls,['card']);
});
test('publication card cooldown or source failure cannot fall through to another external source',async()=>{
 for(const result of [{status:'cooldown',externalRequests:0,nextBatchAt:'2026-10-22T07:00:00Z'},{ok:false,status:'failed',externalRequests:1,error:'JRA取得 HTTP 403'}]){
  const r=await collectLiveHistory({}, {scheduledTime:published},{now:()=>published,missing:async()=>null,registered:async()=>publishedRosters,cards:async()=>result,programs:()=>assert.fail('shared source wait must not be bypassed')});assert.deepEqual(r,result.externalRequests?{...result,historyWorkStage:'acquisition'}:result);
 }
});
test('no-work publication cards permit program recovery without a second card call or roster scan',async()=>{
 let cards=0,registrations=0,programs=0;const r=await collectLiveHistory({}, {scheduledTime:published},{now:()=>published,missing:async()=>null,registered:async()=>{registrations++;return publishedRosters},cards:async()=>{cards++;return{status:'complete',externalRequests:0}},programs:async()=>{programs++;return null},main:async()=>null,upcoming:async()=>null,expected:async()=>({status:'idle',externalRequests:0}),details:async()=>({status:'idle',externalRequests:0})});
 assert.equal(r.status,'idle');assert.deepEqual({cards,registrations,programs},{cards:1,registrations:1,programs:1});
});
test('history passes the prior card lane to the existing card collector without creating an extra source lane',async()=>{let observed;const r=await collectLiveHistory({}, {scheduledTime:start},{now:()=>Date.parse('2026-10-23T04:00:00Z'),previousCardSelection:{lane:'card'},missing:async()=>({status:'official-card-priority',externalRequests:0}),registered:async()=>[{date:'2026-10-24'}],cards:async(_,input,deps)=>{observed=deps.previousCardSelection;return{status:'official-card-index-found',externalRequests:1}},programs:()=>assert.fail('one page only')});assert.equal(observed.lane,'card');assert.equal(r.externalRequests,1);});

test('formal-card history receives alternate existing history slots while card discovery stays busy',async()=>{
 const stamp=Date.parse('2026-10-23T14:30:00Z');let previous=null,previousStage=null;const seen=[];
 const db={prepare(q){assert.match(q,/SELECT next_batch_at,locked_until.*jra-history/);return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 for(let i=0;i<4;i++){
  const result=await collectLiveHistory(db,{scheduledTime:stamp+i*540000},{now:()=>stamp+i*540000,previousCardSelection:previous,previousHistoryWorkStage:previousStage,missing:async()=>({status:'official-card-priority',externalRequests:0}),registered:async()=>[{date:'2026-10-24'}],cards:async()=>{seen.push('cards');return{status:'failed',externalRequests:1,cardSelection:{lane:'discovery',reason:'urgent',lastDiscoveryClass:'retry'}}},upcoming:async()=>{seen.push('history');return{status:'collected',externalRequests:1,stage:'upcoming-official-missing-history',priorityRaceKey:'2026-10-24:東京:12'}},programs:()=>assert.fail('one source slot'),main:()=>assert.fail('one source slot')});
  previous=result.cardSelection||previous;previousStage=result.historyWorkStage;assert.equal(result.externalRequests,1);
 }
 assert.deepEqual(seen,['cards','history','cards','history']);assert.equal(previous.lane,'discovery');assert.equal(previous.lastDiscoveryClass,'retry');
});
test('completion turn observes shared gate/lease before history planning and performs no source request',async()=>{
 const stamp=Date.parse('2026-10-23T14:30:00Z');for(const blocked of [{next_batch_at:stamp+3600000,locked_until:0},{next_batch_at:0,locked_until:stamp+120000}]){
  let reads=0;const result=await collectLiveHistory({prepare(){return{async first(){reads++;return blocked}}}},{scheduledTime:stamp},{now:()=>stamp,previousCardSelection:{lane:'discovery'},previousHistoryWorkStage:'acquisition',missing:async()=>null,registered:async()=>[{date:'2026-10-24'}],cards:()=>assert.fail('shared wait'),upcoming:()=>assert.fail('no planning during wait')});
  assert.equal(result.status,'cooldown');assert.equal(result.externalRequests,0);assert.equal(reads,1);
 }
});
test('no due history falls back to one card attempt without a repeated history scan',async()=>{
 const stamp=Date.parse('2026-10-23T14:30:00Z');let history=0,cards=0;const r=await collectLiveHistory({prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}},{scheduledTime:stamp},{now:()=>stamp,previousCardSelection:{lane:'card'},previousHistoryWorkStage:'acquisition',missing:async()=>null,registered:async()=>[{date:'2026-10-24'}],upcoming:async()=>{history++;return null},cards:async()=>{cards++;return{status:'official-card-link-found',externalRequests:1,cardSelection:{lane:'discovery'}}},programs:()=>assert.fail('one request')});
 assert.equal(history,1);assert.equal(cards,1);assert.equal(r.historyWorkStage,'acquisition');
});
test('D1 quota during completion gate check propagates without card fallback',async()=>{
 const stamp=Date.parse('2026-10-23T14:30:00Z');await assert.rejects(collectLiveHistory({prepare(){throw Error('exceeded D1 daily row read limit')}},{scheduledTime:stamp},{now:()=>stamp,previousCardSelection:{lane:'discovery'},previousHistoryWorkStage:'acquisition',missing:async()=>null,registered:async()=>[{date:'2026-10-24'}],cards:()=>assert.fail('quota'),upcoming:()=>assert.fail('quota')}),/daily row read limit/);
});
test('existing coordinator persists completion-stage turn without a new table or loss of card fairness history',async()=>{
 const {sql,db}=fixture();sql.exec("CREATE TABLE lab_history_collection_budget(name TEXT PRIMARY KEY,next_batch_at INTEGER,locked_until INTEGER);INSERT INTO lab_history_collection_budget VALUES('jra-history',0,0)");let stamp=Date.parse('2026-10-23T14:30:00Z');const seen=[];
 for(let i=0;i<6;i++){
  await dispatchLiveSources({cron:'*/3 * * * *',scheduledTime:stamp},{DB:db},{now:()=>stamp,archive:async()=>({status:'idle',externalRequests:0}),results:async()=>({status:'idle',externalRequests:0}),history:(_,event,context)=>collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,previousCardSelection:context.previousCardSelection,previousHistoryWorkStage:context.previousHistoryWorkStage,missing:async()=>null,registered:async()=>[{date:'2026-10-24'}],cards:async()=>{seen.push('cards');return{status:'failed',externalRequests:1,cardSelection:{lane:'discovery',lastDiscoveryClass:'retry',lastRetryDiscoveryStage:'continuation'}}},upcoming:async()=>{seen.push('history');return{status:'collected',externalRequests:1}},programs:()=>assert.fail('one source only')})});stamp+=180000;
 }
 assert.deepEqual(seen,['cards','history']);const latest=JSON.parse(sql.prepare("SELECT result_json FROM lab_bounded_pipeline_runs WHERE job='history' ORDER BY started_at DESC LIMIT 1").get().result_json);assert.equal(latest.historyWorkStage,'history');assert.equal(latest.cardSelection.lastRetryDiscoveryStage,'continuation');assert.equal(sql.prepare("SELECT COUNT(*) n FROM lab_bounded_pipeline_runs WHERE job='results'").get().n,2);sql.close();
});

test('a returned D1 pause from completion work never falls through to card acquisition',async()=>{
 const stamp=Date.parse('2026-10-23T14:30:00Z');const r=await collectLiveHistory({prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}},{scheduledTime:stamp},{now:()=>stamp,previousCardSelection:{lane:'discovery'},previousHistoryWorkStage:'acquisition',missing:async()=>null,registered:async()=>[{date:'2026-10-24'}],upcoming:async()=>({status:'paused',reason:'d1-daily-read-limit',externalRequests:0}),cards:()=>assert.fail('no work after pause')});assert.equal(r.status,'paused');assert.equal(r.historyWorkStage,undefined);
});

test('scheduled card completion mode uses its existing slot before history without excluding started cards',async()=>{
 let history=0;const stamp=Date.parse('2026-10-24T04:50:00Z');
 const r=await collectLiveHistory({prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}},{scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',missing:async()=>null,registered:async()=>[],cards:async(_,input)=>{assert.deepEqual(input,{date:'2026-10-24',includeFuture:true,completeDateFirst:true,publicationWindowOnly:true});return{status:'official-card-saved',externalRequests:1}},upcoming:async()=>{history++;assert.fail('card slot must not become history')},programs:()=>assert.fail('no second external batch')});
 assert.equal(r.status,'official-card-saved');assert.equal(history,0);assert.equal(r.externalRequests,1);
});


test('Sunday completion starts at the current race day rather than the previous day backlog',async()=>{
 const stamp=Date.parse('2026-10-24T15:10:00Z');let observed;
 await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,missing:async()=>null,registered:async()=>[],cards:async(_,input)=>{observed=input;return{status:'official-card-saved',externalRequests:1}},programs:()=>assert.fail('one source only')});
 assert.equal(observed.date,'2026-10-25');assert.equal(observed.completeDateFirst,true);
});

test('card completion precedes an available supplemental roster and avoids registration scans',async()=>{
 const calls=[];const stamp=Date.parse('2026-10-25T00:30:00Z');
 const r=await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,missing:async()=>{calls.push('roster');return{status:'roster-saved',externalRequests:1}},registered:()=>assert.fail('no roster inventory before card completion'),cards:async()=>{calls.push('card');return{status:'official-card-saved',externalRequests:1}},programs:()=>assert.fail('one source slot')});
 assert.equal(r.status,'official-card-saved');assert.deepEqual(calls,['card']);
});
test('card completion preserves stops and falls back once only when cards have no work',async()=>{
 const stamp=Date.parse('2026-10-25T00:30:00Z');
 for(const status of ['cooldown','lease-unavailable','shared-gate-unavailable','paused']){
  const r=await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,cards:async()=>({status,externalRequests:0}),missing:()=>assert.fail('must preserve card stop'),registered:()=>assert.fail('no inventory on stop')});assert.equal(r.status,status);
 }
 const calls=[];const r=await collectLiveHistory({}, {scheduledTime:stamp},{now:()=>stamp,cardCompletionFirst:true,cards:async()=>{calls.push('card');return{status:'complete',externalRequests:0}},missing:async()=>{calls.push('roster');return{status:'roster-saved',externalRequests:1}},registered:()=>assert.fail('no inventory after roster source')});assert.equal(r.status,'roster-saved');assert.deepEqual(calls,['card','roster']);
});

test('existing source coordinator passes the shared discoverer only when explicitly enabled',async()=>{
 for(const enabled of [false,true]){
  const {sql,db}=fixture();let stamp=Date.parse('2026-10-25T01:30:00Z'),context;
  for(let i=0;i<3;i++){
   await dispatchLiveSources({cron:'*/3 * * * *',scheduledTime:stamp},{DB:db,LAB_SHARED_PAGE_ACQUISITION:enabled?'true':'false',LAB_CARD_COMPLETION_PRIORITIES:'["2026-10-25:京都:3"]'},{now:()=>stamp,archive:async()=>({status:'idle'}),results:async()=>({status:'idle'}),history:async(_,event,deps)=>{context=deps;return{status:'idle'}}});stamp+=180000;
  }
  assert.equal(typeof context.discover,enabled?'function':'undefined');assert.deepEqual(context.completionPriorityRaceKeys,['2026-10-25:京都:3']);sql.close();
 }
});

test('invalid completion priority configuration fails before database or source work',async()=>{
 for(const value of ['{}','["2026-10-25:京都:13"]','["2026-10-25:京都:3","2026-10-25:京都:3"]'])assert.throws(()=>cardCompletionPriorities(value),/Invalid card completion priorities/);
 let observed;await collectLiveHistory({}, {scheduledTime:start},{now:()=>start,cardCompletionFirst:true,completionPriorityRaceKeys:['2026-10-25:京都:3'],cards:async(_,input,deps)=>{observed=deps.completionPriorityRaceKeys;return{status:'official-card-saved',externalRequests:1}}});assert.deepEqual(observed,['2026-10-25:京都:3']);
});


test('saved roster history turn precedes a due supplemental request and yields the next turn back',async()=>{
 const stamp=Date.parse('2026-10-28T06:54:48Z'),seen=[];
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 let stage='acquisition';
 for(let i=0;i<4;i++){
  const r=await collectLiveHistory(db,{scheduledTime:stamp+i*540000},{now:()=>stamp+i*540000,previousHistoryWorkStage:stage,cardCompletionFirst:true,
   cards:async()=>({status:'awaiting-official-publication',externalRequests:0}),registered:async()=>[{date:'2026-11-01'}],
   missing:async()=>{seen.push('roster');return{status:'publication-unconfirmed',externalRequests:1}},
   expected:async()=>{seen.push('history');return{status:'collected',attempted:1,externalRequests:1}},programs:()=>assert.fail('one source only')});
  stage=r.historyWorkStage;assert.equal(r.externalRequests,1);
 }
 assert.deepEqual(seen,['history','roster','history','roster']);
});
test('idle saved history falls through once and a returned safety stop cannot reach supplemental',async()=>{
 const stamp=Date.parse('2026-10-28T06:54:48Z');
 for(const status of ['idle','cooldown','paused','lease-unavailable','shared-gate-unavailable']){
  let history=0,missing=0;const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
  const r=await collectLiveHistory(db,{scheduledTime:stamp},{now:()=>stamp,previousHistoryWorkStage:'acquisition',cardCompletionFirst:true,
   cards:async()=>({status:'awaiting-official-publication',externalRequests:0}),registered:async()=>[{date:'2026-11-01'}],
   expected:async()=>{history++;return{status,externalRequests:0}},missing:async()=>{missing++;return{status:'roster-saved',externalRequests:1}},programs:()=>assert.fail('stop')});
  assert.equal(history,1);assert.equal(missing,status==='idle'?1:0);assert.equal(r.status,status==='idle'?'roster-saved':status);
 }
});

test('actionable saved history keeps its turn after official publication when card discovery has no source work',async()=>{
 const stamp=Date.parse('2026-10-29T00:31:00Z'),seen=[];
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 let stage='acquisition';
 for(let i=0;i<4;i++){
  const r=await collectLiveHistory(db,{scheduledTime:stamp+i*600000},{now:()=>stamp+i*600000,previousHistoryWorkStage:stage,cardCompletionFirst:true,
   cards:async()=>({status:'discovery-not-due',externalRequests:0}),registered:async()=>[{date:'2026-11-01'}],
   missing:async()=>{seen.push('roster');return{status:'publication-unconfirmed',externalRequests:1}},
   expected:async()=>{seen.push('saved-history');return{status:'collected',attempted:1,externalRequests:1}},programs:()=>assert.fail('one source only')});
  stage=r.historyWorkStage;
 }
 assert.deepEqual(seen,['saved-history','roster','saved-history','roster']);
});

test('unresolved saved profiles retain the history turn without starving the next acquisition turn',async()=>{
 const stamp=Date.parse('2026-10-29T00:31:00Z'),seen=[];
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 const waiting=[{raceKey:'2026-10-31:東京:11',missingProfileLinks:['fixture'],pendingHorses:1}];
 const deps={now:()=>stamp,cardCompletionFirst:true,
  cards:async()=>({status:'discovery-not-due',externalRequests:0}),registered:async()=>[{date:'2026-10-31'}],
  expected:async()=>{seen.push('history');return{ok:true,status:'awaiting-source-readiness',waiting,externalRequests:0}},
  missing:async()=>{seen.push('roster');return{status:'publication-unconfirmed',externalRequests:1}},programs:()=>assert.fail('no unrelated work')};
 const first=await collectLiveHistory(db,{scheduledTime:stamp},{...deps,previousHistoryWorkStage:'acquisition'});
 assert.equal(first.blockedStage,'profile-link-discovery');assert.deepEqual(first.waiting,waiting);
 assert.equal(first.externalRequests,0);assert.equal(first.historyWorkStage,'history');assert.deepEqual(seen,['history']);
 const second=await collectLiveHistory(db,{scheduledTime:stamp},{...deps,previousHistoryWorkStage:first.historyWorkStage});
 assert.equal(second.historyWorkStage,'acquisition');assert.deepEqual(seen,['history','roster']);
});

 test('cached shared navigation without a card cannot consume the saved-history turn',async()=>{
 const stamp=Date.parse('2026-10-29T08:06:49Z'),seen=[];
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};
 const cached={status:'page-parsed',attempted:true,reusedBody:true,externalRequests:0,officialCardsCreated:false,discoveredCards:0,discoveredPages:45};
 const deps={now:()=>stamp,cardCompletionFirst:true,cards:async()=>cached,registered:async()=>[{date:'2026-10-31'}],expected:async()=>{seen.push('history');return{status:'collected',externalRequests:1,historyRowsSaved:3}},missing:()=>assert.fail('no unrelated roster'),programs:()=>assert.fail('no unrelated calendar')};
 const first=await collectLiveHistory(db,{scheduledTime:stamp},{...deps,previousHistoryWorkStage:'acquisition'});
 assert.deepEqual(seen,['history']);assert.equal(first.historyRowsSaved,3);assert.equal(first.historyWorkStage,'history');
 const second=await collectLiveHistory(db,{scheduledTime:stamp},{...deps,previousHistoryWorkStage:'history'});
 assert.equal(second.status,'page-parsed');assert.equal(second.historyWorkStage,'acquisition');assert.deepEqual(seen,['history']);
 });

test('a saved formal card hands one existing slot to priority formal history before another card',async()=>{
 const db={prepare(){return{async first(){return{next_batch_at:0,locked_until:0}}}}};let calls=[];
 const deps={now:()=>start,cardCompletionFirst:true,cards:async()=>{calls.push('card');return{status:'official-card-saved',formalCardSaved:true,externalRequests:1,cardSelection:{lane:'card'}}},priorityExpected:async(_,d)=>{assert.equal(d.knownProfilesOnly,true);assert.equal(d.includeFormalHistory,true);calls.push('history');return{status:'collected',attempted:1,externalRequests:0,addedRows:3}}};
 const a=await collectLiveHistory(db,{},deps);assert.equal(a.cardSelection.priorityFormalHistoryPending,true);
 const b=await collectLiveHistory(db,{}, {...deps,previousHistoryWorkStage:a.historyWorkStage,previousCardSelection:a.cardSelection});assert.deepEqual(calls,['card','history']);assert.equal(b.addedRows,3);assert.equal(b.cardSelection.priorityFormalHistoryPending,false);
 const c=await collectLiveHistory(db,{}, {...deps,previousHistoryWorkStage:b.historyWorkStage,previousCardSelection:b.cardSelection});assert.equal(c.status,'official-card-saved');assert.deepEqual(calls,['card','history','card']);
});

test('successful navigation also hands off formal history, while shared cooldown stops before either lane',async()=>{
 for(const blocked of [false,true]){let calls=[];const db={prepare(){return{async first(){return{next_batch_at:blocked?start+3600000:0,locked_until:0}}}}};
 const deps={now:()=>start,cardCompletionFirst:true,cards:async()=>({status:'page-parsed',externalRequests:1,httpStatus:200,cardSelection:{lane:'discovery'}}),priorityExpected:async()=>{calls.push('history');return{status:'idle',externalRequests:0}}};
 const first=await collectLiveHistory(db,{},deps);assert.equal(first.cardSelection.priorityFormalHistoryPending,true);
 const r=await collectLiveHistory(db,{}, {...deps,previousHistoryWorkStage:'acquisition',previousCardSelection:first.cardSelection});
 assert.equal(calls.length,blocked?0:1);if(blocked)assert.equal(r.status,'cooldown');else assert.equal(r.status,'page-parsed');}
});
