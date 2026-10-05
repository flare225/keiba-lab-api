import app from './index-v3.7.1.js';
import {VERSION,executeCollection,schedulerStatus} from './scheduler-observability.js';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'observable scheduled collection'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'persisted-collection-runs',now:new Date().toISOString()});
  try{
   if(u.pathname==='/v1/lab/scheduler-status'){
    const limit=Number(u.searchParams.get('limit')||10);
    if(!Number.isInteger(limit)||limit<1||limit>50)return json({ok:false,error:'limit must be 1-50'},400);
    return json(await schedulerStatus(env.DB,{limit}));
   }
   if(u.pathname==='/v1/lab/scheduler-run'){
    if(request.method!=='POST')return json({ok:false,error:'POST required'},405);
    return json(await executeCollection({scheduledTime:Date.now(),cron:'manual'},env,ctx,{trigger:'manual'}));
   }
   return app.fetch(request,env,ctx);
  }catch(error){return json({ok:false,version:VERSION,error:String(error)},500);}
 },
 async scheduled(event,env,ctx){ctx.waitUntil(executeCollection(event,env,ctx));}
};
