import app from './index-v3.8.9.js';

export const VERSION='3.8.10';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
async function first(db,sql,args=[]){try{return await db.prepare(sql).bind(...args).first()}catch{return null}}
async function childJson(request,env,ctx,path){
 const u=new URL(request.url);u.pathname=path;
 const r=await app.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}),env,ctx);
 let data=null;try{data=await r.json()}catch{}
 return{status:r.status,data};
}
async function operationalStatus(request,env,ctx){
 const u=new URL(request.url),track=u.searchParams.get('track')||null;
 const raceKey='2026-10-10:東京:11';
 const precard=await childJson(request,env,ctx,'/v1/lab/precard-context-status');
 const race=await first(env.DB,'SELECT race_key,runner_count FROM jra_races WHERE race_key=?',[raceKey]);
 const stored=await first(env.DB,'SELECT COUNT(*) n,COUNT(DISTINCT horse_no) distinct_n,MIN(horse_no) first_no,MAX(horse_no) last_no FROM jra_runners WHERE race_key=?',[raceKey]);
 const declared=Number(race?.runner_count||0),rows=Number(stored?.n||0),distinct=Number(stored?.distinct_n||0);
 const officialCardStored=Boolean(race&&declared>0&&rows===declared&&distinct===declared&&Number(stored?.first_no)===1&&Number(stored?.last_no)===declared);
 const featured=Number(precard.data?.dataQuality?.featuredRunnerCount||0);
 const precardContextPublished=featured>0;
 let prelock=null;
 if(track){
  const q=new URL(request.url);q.pathname='/v1/lab/prelock-readiness';q.search='';
  q.searchParams.set('date','2026-10-10');q.searchParams.set('venue','東京');q.searchParams.set('race_no','11');q.searchParams.set('track',track);
  const r=await app.fetch(new Request(q.toString(),{method:'GET',headers:request.headers}),env,ctx);
  let data=null;try{data=await r.json()}catch{}
  prelock={httpStatus:r.status,ok:r.ok,data};
 }
 const readyToSeal=Boolean(prelock?.data?.readyToSeal===true);
 const nextGate=!precardContextPublished?'precard-runner-info':!officialCardStored?'official-numbered-card':!track?'explicit-track-assumption':readyToSeal?'prospective-lock':'prelock-remediation';
 return json({
  ok:true,version:VERSION,raceKey,target:{date:'2026-10-10',venue:'東京',raceNo:11,raceName:'サウジアラビアロイヤルカップ'},
  gates:{precardContextPublished,officialCardStored,explicitTrackProvided:Boolean(track),readyToSeal},
  storage:{declaredRunnerCount:declared,storedRunnerRows:rows,distinctHorseNumbers:distinct},
  precard:precard.data?{status:precard.data?.target?.status||null,featuredRunnerCount:featured,officialCardComparison:precard.data?.officialCardComparison||null}:null,
  prelock:prelock?.data||null,nextGate,
  guardrails:{precardNeverAuthoritative:true,horseNumbersNeverInferredBeforeOfficialCard:true,explicitTrackRequiredBeforeSeal:true,prospectiveSealRemainsSeparate:true}
 });
}
async function authorizedAtomicSave(request,env){
 if(!env.USER_MARK_WRITE_TOKEN)return false;
 if(request.headers.get('authorization')!==`Bearer ${env.USER_MARK_WRITE_TOKEN}`)return false;
 let body=null;try{body=await request.clone().json()}catch{}
 const u=new URL(request.url);
 return(body?.confirm??u.searchParams.get('confirm'))==='SAVE';
}

export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(url.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'Saudi RC operational gates'});
  if(url.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'saudi-rc-operational-gates-and-atomic-mark-save',now:new Date().toISOString()});
  if(url.pathname==='/v1/lab/saudi-rc-operational-status'&&request.method==='GET'){
   if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
   return operationalStatus(request,env,ctx);
  }
  if(url.pathname==='/v1/lab/user-marks'&&request.method==='POST'&&await authorizedAtomicSave(request,env)&&typeof env.DB?.batch!=='function'){
   return json({ok:false,version:VERSION,error:'atomic D1 batch support is required for immutable mark persistence',writeReady:false,storageAtomicRequired:true},503);
  }
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}
  if(data&&typeof data==='object'){
   data.version=VERSION;
   if(url.pathname==='/v1/lab/user-mark-capabilities'&&data.principles)data.principles.storageAtomicRequired=true;
  }
  return json(data,response.status);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
