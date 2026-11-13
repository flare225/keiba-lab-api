import {EXPECTED_ROSTER_SEEDS,prepareReviewedRoster} from './expected-roster-seeds.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {jstDay,collectHistoryBatch} from './history-collection-v3.37.0.js';
import {collectMissingOfficialCard} from './missing-official-cards.js';
import {recoverMissingPrograms} from './program-recovery.js';
import {storedExpectedSources} from './expected-roster-registry.js';
import {readConfirmedPredraw} from './confirmed-predraw-roster.js';
import {confirmedPredrawSource} from './confirmed-predraw-history-source.js';
import {collectUpcomingExpectedHistory} from './expected-history-collection-v3.46.0.js';
import {discoverSharedSelectedCard} from './shared-page-acquisition.js';
import {runSourceCoordinator} from './source-coordinator-v3.40.0.js';
import {scheduledAutomaticPrediction} from './automatic-pre-race-prediction.js';
import {scheduledSavedAutomaticSeal} from './saved-automatic-seal-queue.js';
import {scheduledProvisionalPrediction} from './provisional-prediction-queue.js';
import {collectFocusedOutcomes} from './focused-race-outcomes.js';

// Explicit, temporary one-race scope. Invalid/expired scope never falls back to
// the broad queue. Source slots, persisted retry clocks and budget remain owned
// by the existing collectors and coordinator.
export function focusedRaceTarget(value){
 if(value==null||value==='')return null;
 const v=JSON.parse(value),t=targetInput(v),expires=Date.parse(v.expiresAt);
 if(!Number.isFinite(expires)||jstDay(expires)!==t.date)throw Error('Focused race expiry must be on its race date');
 return {...t,expiresAt:new Date(expires).toISOString()};
}
export function focusScheduleState(target,event,stamp){
 const today=jstDay(stamp),until=jstDay(stamp+7*86400000);
 const expiry=Date.parse(target.expiresAt);
 // Pre-race work still stops at expiry. Retain only the same race's outcome
 // lane for a bounded 24h reconciliation window; never fall back to all races.
 if(target.date>until||stamp>=expiry+86400000)return 'focus-expired-or-outside-window';
 if(stamp>=expiry)return event.cron==='*/3 * * * *'?'outcomes':'focus-background-deferred';
 if(target.date<today)return 'focus-expired-or-outside-window';
 return ['*/3 * * * *','0 * * * *'].includes(event.cron)?'active':'focus-background-deferred';
}
// Explicitly authorized data preparation only. It does not add prediction,
// LOCK or results targets, timers, or source slots to the primary focus.
export function preparationRaceTargets(value,focus,stamp){
 if(value==null||value==='')return[];
 const list=JSON.parse(value);
 if(!Array.isArray(list)||!list.length||list.length>2)throw Error('Preparation requires one or two explicit main races');
 const targets=list.map(v=>focusedRaceTarget(JSON.stringify(v)));
 if(targets.some(t=>!t||t.raceNo!==11||t.date>=focus.date)||new Set(targets.map(t=>`${t.date}:${t.venue}:${t.raceNo}`)).size!==targets.length)throw Error('Preparation targets must be distinct earlier main races');
 return targets.filter(t=>focusScheduleState(t,{cron:'*/3 * * * *'},stamp)==='active');
}
const key=t=>`${t.date}:${t.venue}:${t.raceNo}`;
const worked=r=>r&&(r.attempted||r.externalRequests||r.saveMayHaveSucceeded||r.formalCardSaved||['roster-saved','partial-roster-saved','roster-reconciled','cooldown','paused','lease-unavailable','shared-gate-unavailable'].includes(r.status));
async function optionalFirst(db,sql,args){try{return await db.prepare(sql).bind(...args).first();}catch(e){if(/no such table/i.test(String(e)))return null;throw e;}}
// Reuse only reviewed registration facts for the explicit focus. No source HTTP.
export function prepareFocusedReviewedRoster(db,target,stamp){
 const seeds=EXPECTED_ROSTER_SEEDS.filter(s=>s.record.date===target.date&&s.record.venue===target.venue&&s.record.raceNo===target.raceNo);
 return prepareReviewedRoster(db,target.date,target.date,stamp,seeds);
}
export async function focusedStoredSources(db,target,stamp){
 const predraw=await readConfirmedPredraw(db,target),confirmed=predraw&&confirmedPredrawSource(predraw,stamp);
 return confirmed?[confirmed]:(await storedExpectedSources(db,target.date,target.date,target)).filter(s=>s.provider==='JRA');
}
export async function collectFocusedRace(db,target,context={},deps={}){
 const now=deps.now||Date.now,stamp=now();
 const gate=await optionalFirst(db,"SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'",[]);
 if(!gate)return{ok:true,status:'shared-gate-unavailable',externalRequests:0};
 const wait=Math.max(Number(gate.next_batch_at)||0,Number(gate.locked_until)||0);
 if(wait>stamp)return{ok:true,status:'cooldown',externalRequests:0,nextBatchAt:new Date(wait).toISOString()};
 const program=await optionalFirst(db,'SELECT start_time FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=? LIMIT 1',[target.date,target.venue,target.raceNo]);
 if(!program){
  // A missing program clock must not strand already verified registration
  // profiles. Use the existing bounded expected-history lane first, while
  // retaining the program recovery lane when no history work was possible.
  if(context.previousHistoryWorkStage!=='history'){
   const sources=await(deps.sources||focusedStoredSources)(db,target,stamp);
   if(sources.length){
    const result=await(deps.expected||collectUpcomingExpectedHistory)(db,{now,sources,verifyStoredCoverage:true,previousExpectedHistoryWorkKind:context.previousExpectedHistoryWorkKind});
    if(worked(result))return{...result,historyWorkStage:'history',focusRaceKey:key(target)};
   }
  }
  return await(deps.programs||recoverMissingPrograms)(db,{now,target})||{ok:true,status:'focused-program-not-due',externalRequests:0};
 }
 const start=/^\d{2}:\d{2}$/.test(program.start_time||'')?Date.parse(`${target.date}T${program.start_time}:00+09:00`):NaN;
 if(!Number.isFinite(start)||stamp>=start-300000)return{ok:true,status:'focus-start-unverified-or-cutoff',externalRequests:0};
 const formal=await optionalFirst(db,`SELECT race_key FROM jra_races r WHERE race_date=? AND venue=? AND race_no=? AND runner_count>0 AND runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key) AND NOT EXISTS(SELECT 1 FROM jra_runners x WHERE x.race_key=r.race_key AND (x.horse_no NOT BETWEEN 1 AND 18 OR x.horse_name IS NULL OR TRIM(x.horse_name)='')) AND (SELECT COUNT(DISTINCT x.horse_no) FROM jra_runners x WHERE x.race_key=r.race_key)=r.runner_count AND (SELECT COUNT(DISTINCT x.horse_name) FROM jra_runners x WHERE x.race_key=r.race_key)=r.runner_count LIMIT 1`,[target.date,target.venue,target.raceNo]);
 if(formal)return{...await(deps.collect||collectHistoryBatch)(db,{...target,historyLimit:3,batchSize:1,storedBatchSize:2,verifyStoredCoverage:true},{now}),historyWorkStage:'history',focusRaceKey:key(target)};
 let waitingHistory=null;
 const history=async()=>{
  const sources=await(deps.sources||focusedStoredSources)(db,target,stamp);
  waitingHistory=await(deps.expected||collectUpcomingExpectedHistory)(db,{now,sources,verifyStoredCoverage:true,previousExpectedHistoryWorkKind:context.previousExpectedHistoryWorkKind});
  return waitingHistory;
 };
 if(context.previousHistoryWorkStage!=='history'&&!context.formalCardFirst){
  const r=await history();if(worked(r))return{...r,historyWorkStage:'history'};
 }
 const card=await(deps.cards||collectMissingOfficialCard)(db,{...target},{now,previousCardSelection:context.previousCardSelection,...(deps.shared?{discover:discoverSharedSelectedCard}:{})});
 if(worked(card)||card?.reusedBody)return{...card,historyWorkStage:'acquisition'};
 if(context.previousHistoryWorkStage==='history'||context.formalCardFirst){
  const r=await history();if(worked(r))return{...r,historyWorkStage:'history'};
 }
 // No supplementary netkeiba roster or unrelated calendar fallback.
 return{ok:true,status:'focus-awaiting-jra-card-or-profiles',historyWorkStage:'history',focusRaceKey:key(target),cardStatus:card?.status||null,historyStatus:waitingHistory?.status||null,blockedStage:card?.status==='awaiting-official-publication'?'official-publication':'jra-card-or-profile-readiness',waiting:waitingHistory?.waiting||[],externalRequests:0};
}
export async function runFocusedScheduled(event,env,target,deps={}){
 const now=deps.now||Date.now,stamp=now(),state=focusScheduleState(target,event,stamp);
 const preparation=preparationRaceTargets(env.LAB_COMPLETION_PREPARATION_TARGETS,target,stamp);
 if(!['active','outcomes'].includes(state))return{ok:true,status:state,focusRaceKey:key(target),externalRequests:0};
 const db=env.DB;
 if(state==='outcomes'){
  const deferred=async()=>({ok:true,status:'focus-background-deferred',focusRaceKey:key(target),externalRequests:0});
  return(deps.coordinate||runSourceCoordinator)(event,env,{now,jobs:{archive:deferred,history:deferred,results:()=>(deps.outcomes||collectFocusedOutcomes)(db,target,{now})}});
 }
 if(event.cron==='0 * * * *')return(deps.provisional||scheduledProvisionalPrediction)(db,stamp,{prepareRoster:()=>prepareFocusedReviewedRoster(db,target,stamp),sources:()=>focusedStoredSources(db,target,stamp)});
 // Preserve the ordinary scheduler's failure isolation. A local forecast or
 // seal validation error must not prevent the target's missing-data work;
 // quota exhaustion still stops before any later stage or source request.
 const stageErrors=[];
 for(const [stage,work] of [
  ['prediction',()=>(deps.predict||scheduledAutomaticPrediction)(db,stamp,target)],
  ['lock',()=>(deps.seal||scheduledSavedAutomaticSeal)(db,{enabled:env.LAB_SAVED_AUTOMATIC_LOCK==='true',now,target})]
 ])try{await work();}catch(e){if(e?.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e)))throw e;stageErrors.push({stage,error:String(e.message||e),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded});}
 const deferred=async()=>({ok:true,status:'focus-background-deferred',focusRaceKey:key(target),externalRequests:0});
 // Retain the existing 3-lane rotation: do not turn deferred archive/result
 // slots into extra source requests while reserving DB work for this target.
 const history=async context=>{
  const prior=context.previousCardSelection,previousIndex=preparation.findIndex(t=>key(t)===prior?.target);
  const workTarget=preparation.length?preparation[(previousIndex+1)%preparation.length]:target;
  const workKey=key(workTarget),checkpoints=preparation.length?(prior?.preparationContexts||{}):{};
  const checkpoint=checkpoints[workKey];
  if(checkpoint)context={...context,previousCardSelection:checkpoint.selection,previousHistoryWorkStage:checkpoint.historyWorkStage,previousExpectedHistoryWorkKind:checkpoint.expectedHistoryWorkKind,previousOfficialHistoryCursor:checkpoint.officialHistoryCursor};
  // The coordinator intentionally carries old metadata forward. A new focus
  // must not inherit another race's selection or one-shot history handoff.
  const same=context.previousCardSelection?.target===workKey;
  const scoped=same?context:{...context,previousCardSelection:null,previousHistoryWorkStage:null,previousExpectedHistoryWorkKind:null,previousOfficialHistoryCursor:0};
  const rosterPreparation=await(deps.prepareRoster||prepareFocusedReviewedRoster)(db,workTarget,stamp);
  const focusedContext={...(rosterPreparation.saved>0?{...scoped,previousHistoryWorkStage:'acquisition'}:scoped),...(preparation.length?{formalCardFirst:true}:{})};
  const result=await(deps.collect||collectFocusedRace)(db,workTarget,focusedContext,{now,shared:env.LAB_SHARED_PAGE_ACQUISITION==='true'});
  if(result.cardSelection?.target&&result.cardSelection.target!==workKey)throw Error('Focused collector returned another race selection');
  const selection=result.cardSelection||scoped.previousCardSelection||{lane:'discovery',reason:'focused-race-completion'};
  const historyWorkStage=result.historyWorkStage||(!result.historyWorkStage&&rosterPreparation.saved>0?'acquisition':scoped.previousHistoryWorkStage);
  const selected={...selection,target:workKey};delete selected.preparationContexts;
  const nextCheckpoints=preparation.length?Object.fromEntries(preparation.map(t=>key(t)).filter(k=>k===workKey||checkpoints[k]).map(k=>[k,k===workKey?{selection:selected,historyWorkStage,expectedHistoryWorkKind:result.expectedHistoryWorkKind||scoped.previousExpectedHistoryWorkKind,officialHistoryCursor:result.officialHistoryCursor??scoped.previousOfficialHistoryCursor}:checkpoints[k]])):null;
  return{...result,...(historyWorkStage?{historyWorkStage}:{}),rosterPreparation,focusRaceKey:workKey,...(preparation.length?{primaryFocusRaceKey:key(target),dataPreparationOnly:true}:{}),cardSelection:{...selected,...(nextCheckpoints?{preparationContexts:nextCheckpoints}:{})},...(stageErrors.length?{stageErrors}:{})};
 };
 return(deps.coordinate||runSourceCoordinator)(event,env,{now,jobs:{archive:deferred,results:deferred,history}});
}
