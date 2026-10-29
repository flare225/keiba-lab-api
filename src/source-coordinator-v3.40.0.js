import {collectArchiveBatch} from './archive-collection-v3.39.0.js';
import {scheduledRichResult} from './rich-result-collection-v3.39.0.js';
import {scheduledCollection} from './history-collection-v3.37.0.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
export const SOURCE_CRON='*/3 * * * *',LEARNING_CRON='0,10,20,30,40,50 * * * *';
export const LEGACY_SOURCE_CRONS=['5,15,25,35,45,55 * * * *','2,12,22,32,42,52 * * * *','8,18,28,38,48,58 * * * *','45 * * * *','30 * * * *'];
export async function pickSourceJob(db){let rows;try{rows=(await db.prepare(`SELECT job,latest FROM (WITH RECURSIVE jobs(job) AS (VALUES('archive'),('results'),('history')),
 kinds(job,trigger_kind) AS (
  SELECT j.job,(SELECT MIN(p.trigger_kind) FROM lab_bounded_pipeline_runs p WHERE p.job=j.job) FROM jobs j
  UNION ALL
  SELECT k.job,(SELECT MIN(p.trigger_kind) FROM lab_bounded_pipeline_runs p WHERE p.job=k.job AND p.trigger_kind>k.trigger_kind) FROM kinds k WHERE k.trigger_kind IS NOT NULL
 ) SELECT k.job,MAX((SELECT p.started_at FROM lab_bounded_pipeline_runs p WHERE p.job=k.job AND p.trigger_kind=k.trigger_kind ORDER BY p.started_at DESC LIMIT 1)) latest FROM kinds k WHERE k.trigger_kind IS NOT NULL GROUP BY k.job)`).all()).results||[]}catch(e){if(!/no such table/.test(String(e)))throw e;rows=[]}return ['archive','results','history'].map((job,i)=>({job,last:Number(rows.find(x=>x.job===job)?.latest||0),i})).sort((a,b)=>a.last-b.last||a.i-b.i)[0].job}
export async function runSourceCoordinator(event,env,{trigger='scheduled',now=Date.now,jobs={archive:()=>collectArchiveBatch(env.DB),results:()=>scheduledRichResult(env.DB),history:()=>scheduledCollection(env.DB)}}={}){
 const job=await pickSourceJob(env.DB);let previousCardSelection=null,previousHistoryWorkStage=null,previousExpectedHistoryWorkKind=null;
 if(job==='history'){
  let prior;try{prior=await env.DB.prepare("SELECT result_json FROM lab_bounded_pipeline_runs WHERE job='history' AND trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 1").first()}catch(e){if(!/no such table/.test(String(e)))throw e;}
  let r;try{r=JSON.parse(prior?.result_json||'null')}catch{}
  previousExpectedHistoryWorkKind=['known','discovery'].includes(r?.expectedHistoryWorkKind)?r.expectedHistoryWorkKind:null;
  previousHistoryWorkStage=['acquisition','history'].includes(r?.historyWorkStage)?r.historyWorkStage:null;
  previousCardSelection=['card','discovery'].includes(r?.cardSelection?.lane)?r.cardSelection:(['confirmed-predraw-saved','official-card-saved'].includes(r?.status)?{lane:'card',legacy:true}:['official-card-index-found','official-card-link-found'].includes(r?.status)?{lane:'discovery',legacy:true}:null);
  if(r?.card?.kind==='predraw'||r?.status==='confirmed-predraw-saved')previousCardSelection={...previousCardSelection,savedPredrawHistoryPending:true};
 }
 const cron=event.cron||'manual',scheduledTime=event.scheduledTime??now(),runId=trigger==='scheduled'?'source-dispatch:'+cron+':'+scheduledTime:'manual-dispatch:'+crypto.randomUUID();
 return runPipelineJob(env.DB,job,trigger,async()=>{const result=await jobs[job]({previousCardSelection,previousHistoryWorkStage,previousExpectedHistoryWorkKind});return{...result,...(job==='history'&&!result.expectedHistoryWorkKind&&previousExpectedHistoryWorkKind?{expectedHistoryWorkKind:previousExpectedHistoryWorkKind}:{}),...(job==='history'&&!result.historyWorkStage&&previousHistoryWorkStage?{historyWorkStage:previousHistoryWorkStage}:{}),...(job==='history'&&!result.cardSelection&&previousCardSelection?{cardSelection:previousCardSelection}:{}),dispatch:{job,cron,configuredSourceCron:SOURCE_CRON,oneSourceJobPerInvocation:true,selection:'oldest-job-execution'}}},{scheduledTime,now,runId});
}
