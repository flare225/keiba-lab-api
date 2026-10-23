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
import {collectMissingOfficialCard} from './missing-official-cards.js';
import {collectTodayMainHistory} from './today-main-history-priority.js';
import {collectUpcomingOfficialHistory} from './upcoming-official-history.js';
import {scheduledPriorDetails} from './prior-result-details.js';

// JRA ordinary weekend cards start publishing on Thursday; G1 lists can
// precede the ordinary 16:00 window. This changes queue priority, never assumes
// publication or bypasses an existing discovery receipt/lease/cooldown.
// https://www.jra.go.jp/faq/pop02/2_2.html
export function preferOfficialCards(rosters,stamp){
 const today=jstDay(stamp);
 return rosters.some(r=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||''))return false;
  if(r.date===today)return true;
  const day=Date.parse(r.date+'T00:00:00Z');if(!Number.isFinite(day))return false;
  const weekday=new Date(day).getUTCDay(),daysSinceThursday=(weekday+3)%7;
  return stamp>=day-daysSinceThursday*86400000+5*3600000;
 });
}

export async function scheduledMissingRoster(db,event,{now=Date.now}={}){return runPipelineJob(db,'missing-roster','scheduled',()=>measureD1Operation(db,m=>collectMissingRoster(m,null,{now})),{scheduledTime:event.scheduledTime});}

// Priorities belong inside the history lane, never ahead of the common fair
// dispatcher: a nonempty card/history queue must not suppress result collection.
export async function collectLiveHistory(db,event,{now=Date.now,previousCardSelection=null,cards=collectMissingOfficialCard,main=collectTodayMainHistory,upcoming=collectUpcomingOfficialHistory,expected=scheduledWeekendHistory,details=scheduledPriorDetails,registered=storedExpectedSources,programs=recoverMissingPrograms,missing=scheduledMissingRoster}={}){
 // Reuse saved programs/receipts before reserving a calendar page. The roster
 // collector retains the same shared lease, cooldown and hourly source limit.
 const supplemental=await missing(db,event,{now});if(supplemental&&(supplemental.externalRequests||supplemental.status==='cooldown'||supplemental.saveMayHaveSucceeded||['roster-saved','roster-reconciled'].includes(supplemental.status)))return supplemental;
 const deps={now,previousCardSelection},today=jstDay(now()),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const rosters=await registered(db,today,until);
 // In the existing publication window, use stored race programs for card
 // discovery before an unrelated calendar request can reserve the shared slot.
 // The card collector still owns its usual gate/lease/receipt checks.
 const officialFirst=preferOfficialCards(rosters,now());
 const card=officialFirst?await cards(db,{upcomingOnly:true,includeFuture:true},deps):null;
 if(card&&(card.externalRequests||card.status==='cooldown'||card.saveMayHaveSucceeded))return card;
 const recovery=await programs(db,{now});if(recovery&&(recovery.externalRequests||recovery.status==='cooldown'||recovery.saveMayHaveSucceeded))return recovery;
 let early=null;
 if(rosters.length&&!officialFirst){early=await expected(db,deps);if(early.externalRequests||early.attempted||early.status==='cooldown')return early;}

 const remainingCard=card||await cards(db,{upcomingOnly:true,includeFuture:true},deps);
 if(remainingCard.externalRequests||remainingCard.status==='cooldown'||remainingCard.saveMayHaveSucceeded)return remainingCard;
 const priority=await main(db,deps);if(priority)return priority;
 const next=await upcoming(db,deps);if(next)return next;
 const remainder=early||await expected(db,deps);
 if(remainder.externalRequests||remainder.attempted||remainder.status==='cooldown')return remainder;
 if(Math.floor(Number(event.scheduledTime)/60000)%12===0)return details(db,deps);
 return remainder;
}
export async function dispatchLiveSources(event,env,{now=Date.now,archive=collectArchiveBatch,results=scheduledRichResult,history=collectLiveHistory}={}){
 return runSourceCoordinator(event,env,{now,jobs:{archive:()=>archive(env.DB,{now}),results:()=>results(env.DB,{now}),history:context=>history(env.DB,event,{now,previousCardSelection:context.previousCardSelection})}});
}
