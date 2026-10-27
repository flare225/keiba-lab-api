import {discoverSharedSelectedCard} from './shared-page-acquisition.js';
import {collectMissingRoster} from './missing-roster-acquisition.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
import {measureD1Operation} from './d1-operation-metrics.js';
import {recoverMissingPrograms} from './program-recovery.js';
import {storedExpectedSources} from './expected-roster-registry.js';
import {jstDay} from './history-collection-v3.37.0.js';
import {runSourceCoordinator} from './source-coordinator-v3.40.0.js';
import {collectArchiveBatch} from './archive-collection-v3.39.0.js';
import {scheduledRichResult} from './rich-result-collection-v3.39.0.js';
import {scheduledWeekendHistory} from './expected-history-collection-v3.46.0.js';
import {collectMissingOfficialCard,officialCardWindowOpen} from './missing-official-cards.js';
import {collectTodayMainHistory} from './today-main-history-priority.js';
import {collectUpcomingOfficialHistory} from './upcoming-official-history.js';
import {scheduledPriorDetails} from './prior-result-details.js';

// JRA ordinary weekend cards start publishing on Thursday; G1 lists can
// precede the ordinary 16:00 window. This changes queue priority, never assumes
// publication or bypasses an existing discovery receipt/lease/cooldown.
// https://www.jra.go.jp/faq/pop02/2_2.html
export function preferOfficialCards(rosters,stamp){
 return rosters.some(r=>officialCardWindowOpen(r.date,stamp));
}

export async function scheduledMissingRoster(db,event,{now=Date.now,resumeOnly=false}={}){
 if(resumeOnly)return measureD1Operation(db,m=>collectMissingRoster(m,null,{now,resumeOnly}),now);
 return runPipelineJob(db,'missing-roster','scheduled',()=>measureD1Operation(db,m=>collectMissingRoster(m,null,{now})),{scheduledTime:event.scheduledTime});
}

// Priorities belong inside the history lane, never ahead of the common fair
// dispatcher: a nonempty card/history queue must not suppress result collection.
export async function collectLiveHistory(db,event,{now=Date.now,previousCardSelection=null,previousHistoryWorkStage=null,cardCompletionFirst=false,completionPriorityRaceKeys=[],discover=null,cards=collectMissingOfficialCard,main=collectTodayMainHistory,upcoming=collectUpcomingOfficialHistory,expected=scheduledWeekendHistory,details=scheduledPriorDetails,registered=storedExpectedSources,programs=recoverMissingPrograms,missing=scheduledMissingRoster}={}){
 // Stage history is separate from card-candidate fairness. It is carried in
 // the existing coordinator result, with no new table or periodic clock.
 const acquisition=r=>r&&(r.externalRequests||r.attempted||r.saveMayHaveSucceeded)?{...r,historyWorkStage:'acquisition'}:r;
 const history=r=>r&&(r.externalRequests||r.attempted||r.saveMayHaveSucceeded)?{...r,historyWorkStage:'history'}:r;
 let checkedUpcoming=false;
 if(previousHistoryWorkStage==='acquisition'){
  const gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first();
  if(!gate)return{ok:true,status:'shared-gate-unavailable',externalRequests:0};
  const blocked=Math.max(Number(gate.next_batch_at)||0,Number(gate.locked_until)||0);
  if(blocked>now()){
   // A cached OWN receipt needs no external slot. Give only this narrowly
   // bounded local resume check a chance; fresh requests remain blocked by the
   // collector's normal shared-gate/lease/source-clock checks.
   const resume=await missing(db,event,{now,resumeOnly:true});
   if(resume&&resume.status!=='no-resumable-own-receipt')return acquisition({...resume,attempted:true});
   return{ok:true,status:'cooldown',nextBatchAt:new Date(blocked).toISOString(),externalRequests:0,...(resume?{resumeCheck:{status:resume.status,metrics:resume.metrics}}:{})};
  }
  if(!cardCompletionFirst){checkedUpcoming=true;const completion=await measureD1Operation(db,measured=>upcoming(measured,{now,previousCardSelection}),now);
  if(completion&&(completion.externalRequests||completion.attempted||completion.saveMayHaveSucceeded||['cooldown','lease-unavailable','shared-gate-unavailable','paused'].includes(completion.status)))return history(completion);}
 }
 const deps={now,previousCardSelection,completionPriorityRaceKeys,programPlanCache:new Map(),...(typeof discover==='function'?{discover}:{})},today=jstDay(now()),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 // Complete cards before supplemental acquisition or its roster inventory read.
 // The existing card collector remains responsible for gate, lease and budget.
 const cardInput=cardCompletionFirst?{date:today,includeFuture:true,completeDateFirst:true}:{upcomingOnly:true,includeFuture:true};
 const stops=r=>r&&(r.externalRequests||r.attempted||r.saveMayHaveSucceeded||['cooldown','lease-unavailable','shared-gate-unavailable','paused'].includes(r.status));
 let card=cardCompletionFirst?await cards(db,{...cardInput,publicationWindowOnly:true},deps):null;
 if(stops(card))return acquisition(card);
 const preparing=card?.status==='awaiting-official-publication';if(preparing)card=null;
 const supplemental=await missing(db,event,{now});if(supplemental&&(supplemental.externalRequests||supplemental.status==='cooldown'||supplemental.saveMayHaveSucceeded||['roster-saved','roster-reconciled'].includes(supplemental.status)))return acquisition(supplemental);
 const rosters=await registered(db,today,until);
 const officialFirst=!preparing&&(cardCompletionFirst||preferOfficialCards(rosters,now()));
 if(officialFirst&&!card)card=await cards(db,cardInput,deps);
 if(stops(card))return acquisition(card);
 const recovery=await programs(db,{now});
 const programReadback=Number(recovery?.programRowsSaved)>0||Number(recovery?.readbackVerified)>0;
 if(recovery&&(recovery.externalRequests||recovery.status==='cooldown'||recovery.saveMayHaveSucceeded||programReadback))return acquisition(programReadback?{...recovery,attempted:true}:recovery);
 let early=null;
 if(rosters.length&&!officialFirst){early=await expected(db,deps);if(early.externalRequests||early.attempted||early.status==='cooldown')return history(early);}

 const remainingCard=card||await cards(db,cardInput,deps);
 if(stops(remainingCard))return acquisition(remainingCard);
 const priority=await main(db,deps);if(priority)return history(priority);
 const next=checkedUpcoming?null:await upcoming(db,deps);if(next)return history(next);
 const remainder=early||await expected(db,deps);
 if(remainder.externalRequests||remainder.attempted||remainder.status==='cooldown')return history(remainder);
 if(Math.floor(Number(event.scheduledTime)/60000)%12===0)return details(db,deps);
 return remainder;
}
export function cardCompletionPriorities(value){
 const completionPriorityRaceKeys=JSON.parse(value||'[]');
 if(!Array.isArray(completionPriorityRaceKeys)||completionPriorityRaceKeys.length>72||new Set(completionPriorityRaceKeys).size!==completionPriorityRaceKeys.length||completionPriorityRaceKeys.some(k=>typeof k!=='string'||!/^\d{4}-\d{2}-\d{2}:(東京|京都|新潟|札幌|函館|福島|中山|中京|阪神|小倉):([1-9]|1[0-2])$/.test(k)))throw Error('Invalid card completion priorities');
 return completionPriorityRaceKeys;
}
export async function dispatchLiveSources(event,env,{now=Date.now,archive=collectArchiveBatch,results=scheduledRichResult,history=collectLiveHistory}={}){
 return runSourceCoordinator(event,env,{now,jobs:{archive:()=>archive(env.DB,{now}),results:()=>results(env.DB,{now}),history:context=>history(env.DB,event,{now,previousCardSelection:context.previousCardSelection,previousHistoryWorkStage:context.previousHistoryWorkStage,cardCompletionFirst:true,completionPriorityRaceKeys:cardCompletionPriorities(env.LAB_CARD_COMPLETION_PRIORITIES),...(env.LAB_SHARED_PAGE_ACQUISITION==='true'?{discover:discoverSharedSelectedCard}:{})})}});
}
