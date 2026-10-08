import app from './index-v3.36.0.js';
import {completeCollectedTraining} from './history-learning-completion.js';
import {collectHistoryBatch,collectionStatus,scheduledCollection} from './history-collection-v3.37.0.js';
import {scheduledExperiment} from './learning-experiment-v3.36.0.js';
export const VERSION='3.37.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export const HISTORY_CRON='5,15,25,35,45,55 * * * *',LEARNING_CRON='0,10,20,30,40,50 * * * *';
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'cached and prioritized bounded history collection'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'cached-priority-history-throughput',now:new Date().toISOString()});
  try{
   if(u.pathname==='/v1/lab/history-collection-status'&&request.method==='GET')return json({...await collectionStatus(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no'),historyLimit:u.searchParams.get('history_limit')||10}),version:VERSION});
   if(u.pathname==='/v1/lab/history-collection-batch'&&request.method==='POST'){const b=await request.json();if(b.confirm!=='COLLECT')throw Error('confirm COLLECT is required');return json({...await completeCollectedTraining(env.DB,await collectHistoryBatch(env.DB,b)),version:VERSION});}
   if(u.pathname==='/v1/lab/history-priority-batch'&&request.method==='POST'){const b=await request.json();if(b.confirm!=='COLLECT')throw Error('confirm COLLECT is required');return json({...await scheduledCollection(env.DB),version:VERSION});}
  }catch(error){return json({ok:false,error:String(error.message||error),version:VERSION},400)}
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{if(u.pathname==='/lab/learning-experiment')return new Response((await response.text()).replace('毎時15分に最大1レース分の処理を進めます。','最大10分ごとに、学習データ作成を1レース・履歴収集を1頭ずつ進めます。取得制限やエラー時は休止します。').replace('td,th{text-align:left','th:first-child,td:first-child{min-width:150px;white-space:nowrap}td{vertical-align:top}td,th{text-align:left'),{status:response.status,headers:response.headers});return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){if(event.cron===HISTORY_CRON||event.cron==='30 * * * *'){ctx.waitUntil(scheduledCollection(env.DB).then(result=>console.log('prioritized-history',JSON.stringify({status:result.status,attempted:result.attempted,externalRequests:result.externalRequests,addedRows:result.addedRows}))).catch(error=>{console.error('prioritized-history-failed',String(error));throw error}));return}if(event.cron===LEARNING_CRON||event.cron==='15 * * * *'){ctx.waitUntil(scheduledExperiment(env.DB).then(result=>console.log('bounded-learning',JSON.stringify(result))).catch(error=>{console.error('bounded-learning-failed',String(error));throw error}));return}return app.scheduled(event,env,ctx)}
};
