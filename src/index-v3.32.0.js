import app from './index-v3.31.0.js';
import {collectHistoryBatch,collectionStatus,scheduledCollection,jstDay} from './history-collection-v3.32.0.js';
import {historyCollectionPage} from './history-collection-page-v3.32.0.js';
export const VERSION='3.32.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'bounded resumable JRA horse history collection'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'bounded-history-collector',now:new Date().toISOString()});
  if(u.pathname==='/lab/history-collection'&&request.method==='GET')return new Response(historyCollectionPage(jstDay(Date.now())),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  try{
   if(u.pathname==='/v1/lab/history-collection-status'&&request.method==='GET')return json({...await collectionStatus(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no'),historyLimit:u.searchParams.get('history_limit')||10}),version:VERSION});
   if(u.pathname==='/v1/lab/history-collection-batch'&&request.method==='POST'){const body=await request.json();if(body.confirm!=='COLLECT')return json({ok:false,error:'confirm COLLECT is required'},400);return json({...await collectHistoryBatch(env.DB,body),version:VERSION});}
  }catch(error){return json({ok:false,error:String(error.message||error),version:VERSION},400)}
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){if(event.cron==='30 * * * *'){ctx.waitUntil(scheduledCollection(env.DB).then(result=>console.log('history-collection',JSON.stringify({status:result.status,attempted:result.attempted,externalRequests:result.externalRequests,addedRows:result.addedRows,results:result.results}))).catch(error=>{console.error('history-collection-failed',String(error));throw error}));return}return app.scheduled(event,env,ctx)}
};
