import app from './index-v3.45.0.js';
import {expectedHistoryStatus,scheduledWeekendHistory} from './expected-history-collection-v3.46.0.js';
import {runSourceCoordinator,SOURCE_CRON,LEGACY_SOURCE_CRONS} from './source-coordinator-v3.40.0.js';
import {collectArchiveBatch} from './archive-collection-v3.39.0.js';
import {scheduledRichResult} from './rich-result-collection-v3.39.0.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
export const VERSION='3.46.0';
const json=(d,status=200)=>new Response(JSON.stringify(d,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*'}});
const jobs=env=>({archive:()=>collectArchiveBatch(env.DB),results:()=>scheduledRichResult(env.DB),history:()=>scheduledWeekendHistory(env.DB)});
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'pre-card-expected-jra-history-priority-shared-budget',now:new Date().toISOString()});
 try{
  if(u.pathname==='/v1/lab/expected-history-status'&&request.method==='GET')return json({ok:true,...await expectedHistoryStatus(env.DB),version:VERSION});
  if(['/v1/lab/source-coordinator-batch','/v1/lab/history-priority-batch'].includes(u.pathname)&&request.method==='POST'){
   const b=await request.json();if(b.confirm!=='COLLECT')return json({ok:false,error:'確認指定が必要です。',version:VERSION},400);
   const r=u.pathname.endsWith('source-coordinator-batch')?await runSourceCoordinator({cron:'manual',scheduledTime:Date.now()},env,{trigger:'manual',jobs:jobs(env)}):await runPipelineJob(env.DB,'history','manual',()=>scheduledWeekendHistory(env.DB));return json({...r,version:VERSION});
  }
  if(u.pathname==='/v1/lab/work-progress'&&request.method==='GET'){
   const r=await app.fetch(request,env,ctx),d=await r.json();if(!r.ok||!d.ok)return json({...d,version:VERSION},r.status);return json({...d,expectedHistory:await expectedHistoryStatus(env.DB),version:VERSION});
  }
 }catch(e){return json({ok:false,version:VERSION,error:'想定馬の補完状態を確認できません。履歴ゼロとは判定していません。'},503);}
 const r=await app.fetch(request,env,ctx);let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object')d.version=VERSION;return json(d,r.status);
},async scheduled(event,env,ctx){
 if(event.cron===SOURCE_CRON||LEGACY_SOURCE_CRONS.includes(event.cron)){ctx.waitUntil(runSourceCoordinator(event,env,{jobs:jobs(env)}).catch(e=>{console.error('source-dispatch',String(e));throw e;}));return;}
 return app.scheduled(event,env,ctx);
}};
