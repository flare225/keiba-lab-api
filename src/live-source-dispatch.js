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

// Priorities belong inside the history lane, never ahead of the common fair
// dispatcher: a nonempty card/history queue must not suppress result collection.
export async function collectLiveHistory(db,event,{now=Date.now,cards=collectMissingOfficialCard,main=collectTodayMainHistory,upcoming=collectUpcomingOfficialHistory,expected=scheduledWeekendHistory,details=scheduledPriorDetails,registered=storedExpectedSources}={}){
 const deps={now},today=jstDay(now()),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const rosters=await registered(db,today,until);
 if(rosters.length){const early=await expected(db,deps);if(early.externalRequests||early.attempted||early.status==='cooldown')return early;}

 const card=await cards(db,{upcomingOnly:true,includeFuture:true},deps);
 if(card.externalRequests||card.status==='cooldown')return card;
 const priority=await main(db,deps);if(priority)return priority;
 const next=await upcoming(db,deps);if(next)return next;
 const remainder=await expected(db,deps);
 if(remainder.externalRequests||remainder.attempted||remainder.status==='cooldown')return remainder;
 if(Math.floor(Number(event.scheduledTime)/60000)%12===0)return details(db,deps);
 return remainder;
}
export async function dispatchLiveSources(event,env,{now=Date.now,archive=collectArchiveBatch,results=scheduledRichResult,history=collectLiveHistory}={}){
 return runSourceCoordinator(event,env,{now,jobs:{archive:()=>archive(env.DB,{now}),results:()=>results(env.DB,{now}),history:()=>history(env.DB,event,{now})}});
}
