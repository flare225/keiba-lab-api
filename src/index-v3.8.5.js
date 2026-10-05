import app from './index-v3.8.4.js';
import {PRECARD_VERSION,DEFAULT_PRECARD_TARGETS,ensurePrecardTables,seedDefaultPrecardTargets,ingestPrecardTarget,precardAudit,runPrecardSweep} from './precard-context-v3.8.5.js';

export const VERSION='3.8.5';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});

async function targetByKey(db,raceKey){return db.prepare('SELECT * FROM lab_precard_targets WHERE race_key=?').bind(raceKey).first();}
async function init(db){await ensurePrecardTables(db);await seedDefaultPrecardTargets(db);}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'isolated pre-card context + two-year-old evidence audit'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'precard-context-isolation-and-official-card-diff',now:new Date().toISOString()});
  if(u.pathname.startsWith('/v1/lab/precard-')&&!env.DB)return json({ok:false,version:VERSION,error:'D1 binding DB is not configured'},500);
  try{
   if(u.pathname==='/v1/lab/precard-targets'){
    await init(env.DB);
    const rows=(await env.DB.prepare('SELECT * FROM lab_precard_targets ORDER BY race_date,venue,race_no').all()).results||[];
    return json({ok:true,version:VERSION,stage:'precard-targets',targets:rows,defaults:DEFAULT_PRECARD_TARGETS});
   }
   if(u.pathname==='/v1/lab/precard-context-status'){
    await init(env.DB);const raceKey=u.searchParams.get('race_key')||DEFAULT_PRECARD_TARGETS[0].raceKey;
    const audit=await precardAudit(env.DB,raceKey);return json(audit,audit.ok?200:404);
   }
   if(u.pathname==='/v1/lab/precard-context-ingest'){
    if(request.method!=='POST')return json({ok:false,version:VERSION,error:'POST required for precard ingestion'},405);
    await init(env.DB);const raceKey=u.searchParams.get('race_key')||DEFAULT_PRECARD_TARGETS[0].raceKey;
    const target=await targetByKey(env.DB,raceKey);if(!target)return json({ok:false,version:VERSION,error:'precard target not found'},404);
    const result=await ingestPrecardTarget(env.DB,target,{now:new Date()});return json({...result,version:VERSION},result.ok?200:409);
   }
   if(u.pathname==='/v1/lab/precard-context-sweep'){
    if(request.method!=='POST')return json({ok:false,version:VERSION,error:'POST required for precard sweep'},405);
    const result=await runPrecardSweep({scheduledTime:Date.now()},env,ctx);return json(result,result.ok?200:409);
   }
   return app.fetch(request,env,ctx);
  }catch(error){return json({ok:false,version:VERSION,error:String(error)},500)}
 },
 async scheduled(event,env,ctx){
  app.scheduled(event,env,ctx);
  ctx.waitUntil(runPrecardSweep(event,env,ctx).catch(error=>console.error('precard context sweep failed',String(error))));
 }
};

export {PRECARD_VERSION};
