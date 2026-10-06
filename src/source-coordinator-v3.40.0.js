import {collectArchiveBatch} from './archive-collection-v3.39.0.js';
import {scheduledRichResult} from './rich-result-collection-v3.39.0.js';
import {scheduledCollection} from './history-collection-v3.37.0.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
export const SOURCE_CRON='*/3 * * * *',LEARNING_CRON='0,10,20,30,40,50 * * * *';
export const LEGACY_SOURCE_CRONS=['5,15,25,35,45,55 * * * *','2,12,22,32,42,52 * * * *','8,18,28,38,48,58 * * * *','45 * * * *','30 * * * *'];
export async function pickSourceJob(db){let rows;try{rows=(await db.prepare("SELECT job,MAX(started_at) latest FROM lab_bounded_pipeline_runs WHERE job IN ('archive','results','history') GROUP BY job").all()).results||[]}catch(e){if(!/no such table/.test(String(e)))throw e;rows=[]}return ['archive','results','history'].map((job,i)=>({job,last:Number(rows.find(x=>x.job===job)?.latest||0),i})).sort((a,b)=>a.last-b.last||a.i-b.i)[0].job}
export async function runSourceCoordinator(event,env,{trigger='scheduled',now=Date.now,jobs={archive:()=>collectArchiveBatch(env.DB),results:()=>scheduledRichResult(env.DB),history:()=>scheduledCollection(env.DB)}}={}){
 const job=await pickSourceJob(env.DB),cron=event.cron||'manual',scheduledTime=event.scheduledTime??now(),runId=trigger==='scheduled'?'source-dispatch:'+cron+':'+scheduledTime:'manual-dispatch:'+crypto.randomUUID();
 return runPipelineJob(env.DB,job,trigger,async()=>{const result=await jobs[job]();return{...result,dispatch:{job,cron,configuredSourceCron:SOURCE_CRON,oneSourceJobPerInvocation:true,selection:'oldest-job-execution'}}},{scheduledTime,now,runId});
}
