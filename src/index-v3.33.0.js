import app from './index-v3.32.0.js';
import {collectRichResult,richResultStatus,scheduledRichResult} from './rich-result-collection-v3.33.0.js';
import {resultCollectionPage} from './result-collection-page-v3.33.0.js';
export const VERSION='3.33.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'bounded official result detail collection'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'bounded-rich-results',now:new Date().toISOString()});
  if(u.pathname==='/lab/result-collection'&&request.method==='GET')return new Response(resultCollectionPage(),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  try{
   if(['/v1/lab/result-learning-status','/v1/lab/history-result-status'].includes(u.pathname)&&request.method==='GET')return json({...await richResultStatus(env.DB,u.searchParams.get('date')),version:VERSION});
   if(['/v1/lab/history-result-batch','/v1/lab/result-enrich'].includes(u.pathname)&&request.method==='POST'){const body=await request.json();if(!['INGEST','COLLECT'].includes(body.confirm))return json({ok:false,error:'confirm INGEST or COLLECT is required'},409);return json({...await collectRichResult(env.DB,body),version:VERSION});}
   if(u.pathname==='/v1/lab/result-day-enrich'&&request.method==='POST'){const body=await request.json();if(body.confirm!=='INGEST')return json({ok:false,error:'confirm INGEST is required'},409);const status=await richResultStatus(env.DB,body.date);const race=status.details.find(x=>!x.richComplete);const result=race?await collectRichResult(env.DB,{date:body.date,venue:race.venue,raceNo:race.race_no}):{ok:true,status:'complete',externalRequests:0};return json({ok:result.ok,version:VERSION,stage:'result-day-enrich-batch',date:body.date,attempted:result.externalRequests?1:0,succeeded:result.ok&&result.externalRequests?1:0,processed:race?[result]:[],status:await richResultStatus(env.DB,body.date)});}
  }catch(error){return json({ok:false,error:String(error.message||error),version:VERSION},400)}
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{if(u.pathname==='/lab/history-collection')return new Response((await response.text()).replace('</main>','<p><a href="/lab/result-collection">上がり・通過順の補完状況へ</a></p></main>'),{status:response.status,headers:response.headers});return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){if(event.cron==='45 * * * *'){ctx.waitUntil(scheduledRichResult(env.DB).then(result=>console.log('rich-result-collection',JSON.stringify(result))).catch(error=>{console.error('rich-result-collection-failed',String(error));throw error}));return}return app.scheduled(event,{...env,LAB_BOUNDED_RESULT_COLLECTION:true},ctx)}
};
