import app from './index-v3.9.0.js';
import {historicalEvidenceForHorse,historicalEvidenceForMarked} from './history-evidence-v3.9.1.js';
export const VERSION='3.9.1';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');

async function addHistorySidecar(request,response,env){
 let data;try{data=await response.clone().json()}catch{return response}
 if(!response.ok||!data?.audit||!env.DB){if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status)}
 let body=null;try{body=await request.clone().json()}catch{}
 const targetDate=String(body?.date||'');
 if(!validDate(targetDate)){data.version=VERSION;return json(data,response.status)}
 const marked=(data.audit.marked||[]).map(x=>({horseName:x.horseName,horseNo:x.horseNo,mark:x.mark})).filter(x=>x.horseName);
 data.audit.historySidecar=await historicalEvidenceForMarked(env.DB,{targetDate,marked,limit:8});
 data.audit.guardrails={...(data.audit.guardrails||{}),historicalResultLeakageBlocked:true,historicalEvidenceCutoff:'race_date < target_date',historicalEvidenceDoesNotMutateScore:true};
 data.version=VERSION;data.scoreMutation=false;
 return json(data,response.status);
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'leakage-safe historical evidence sidecar'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'history-sidecar-anti-leakage',now:new Date().toISOString()});
  if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
  try{
   if(u.pathname==='/v1/lab/historical-evidence'&&request.method==='GET'){
    const horseName=u.searchParams.get('horse_name')||u.searchParams.get('horseName'),beforeDate=u.searchParams.get('before_date')||u.searchParams.get('beforeDate');
    if(!horseName||!validDate(beforeDate))return json({ok:false,version:VERSION,error:'horse_name and before_date=YYYY-MM-DD required'},400);
    return json({ok:true,version:VERSION,evidence:await historicalEvidenceForHorse(env.DB,{horseName,beforeDate,limit:u.searchParams.get('limit')||8}),guardrails:{futureAndSameDayResultsExcluded:true,scoreMutation:false}});
   }
   if((u.pathname==='/v1/lab/user-mark-audit'||u.pathname==='/v1/lab/user-marks')&&request.method==='POST')return await addHistorySidecar(request,await app.fetch(request,env,ctx),env);
   const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
  }catch(e){return json({ok:false,version:VERSION,error:String(e?.message||e),scoreMutation:false},500)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
