import app from './index-v3.8.3.js';

export const VERSION='3.8.4';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')}

async function invoke(origin,path,params,env,ctx){
 const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));
 const r=await app.fetch(new Request(u.href,{method:'GET'}),env,ctx);let data;try{data=await r.json()}catch{data={ok:false,error:`non-json response (${r.status})`}}
 return{status:r.status,data};
}
function sealImmutable(d){return d?.immutable===true||d?.seal?.immutable===true}
export function verifySealIdentity(first,second){
 const a=String(first?.seal?.snapshotSha256||'').toLowerCase();
 const b=String(second?.seal?.snapshotSha256||'').toLowerCase();
 const hashShape=/^[0-9a-f]{64}$/;
 const sameHash=hashShape.test(a)&&a===b;
 const firstImmutable=sealImmutable(first),secondImmutable=sealImmutable(second);
 const secondIdempotent=second?.idempotent===true;
 return{ok:sameHash&&firstImmutable&&secondImmutable&&secondIdempotent,sameHash,firstHash:a||null,secondHash:b||null,firstImmutable,secondImmutable,secondIdempotent};
}

async function prelockRun(request,env,ctx){
 const u=new URL(request.url),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')),track=u.searchParams.get('track');
 const sealRequested=u.searchParams.get('seal')==='1',confirm=u.searchParams.get('confirm');
 if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12||!track){
  return{status:400,data:{ok:false,version:VERSION,error:'date=YYYY-MM-DD, venue, race_no=1-12 and explicit track are required'}};
 }
 if(sealRequested&&confirm!=='LOCK'){
  return{status:400,data:{ok:false,version:VERSION,error:'seal=1 requires confirm=LOCK',target:{date,venue,raceNo,trackAssumption:track}}};
 }
 if(!env.DB)return{status:500,data:{ok:false,version:VERSION,error:'D1 binding DB is not configured'}};
 const common={date,venue,race_no:raceNo,track};

 const build=await invoke(u.origin,'/v1/lab/prelock-build',common,env,ctx);
 const buildSummary={httpStatus:build.status,ok:build.status<400&&build.data?.ok!==false,coreFeatureAudit:build.data?.coreFeatureAudit||null,stages:build.data?.stages||null,error:build.data?.error||null};
 if(!buildSummary.ok){
  return{status:409,data:{ok:false,version:VERSION,stage:'prelock-orchestrator',mode:sealRequested?'seal':'prepare',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,sealWritten:false,error:'prelock build did not complete; sealing refused'}};
 }

 const readiness=await invoke(u.origin,'/v1/lab/prelock-readiness',common,env,ctx);
 const readinessSummary={httpStatus:readiness.status,ok:readiness.status<400&&readiness.data?.ok!==false,readyToSeal:readiness.data?.readyToSeal===true,blockers:readiness.data?.blockers||[],warnings:readiness.data?.warnings||[],coreFeatureAudit:readiness.data?.coreFeatureAudit||null,error:readiness.data?.error||null};
 if(!readinessSummary.ok||!readinessSummary.readyToSeal){
  return{status:409,data:{ok:false,version:VERSION,stage:'prelock-orchestrator',mode:sealRequested?'seal':'prepare',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,sealWritten:false,error:'prelock readiness is not green; sealing refused'}};
 }

 if(!sealRequested){
  return{status:200,data:{ok:true,version:VERSION,stage:'prelock-orchestrator',mode:'prepare',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,sealWritten:false,next:'Re-run the same endpoint with seal=1&confirm=LOCK only after reviewing warnings and keeping the same explicit track assumption.'}};
 }

 const first=await invoke(u.origin,'/v1/lab/prospective-seal',common,env,ctx);
 if(first.status>=400||first.data?.ok===false){
  return{status:first.status>=400?first.status:409,data:{ok:false,version:VERSION,stage:'prelock-orchestrator',mode:'seal',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,sealWritten:false,error:'first immutable seal call failed',sealError:first.data?.error||null}};
 }
 const second=await invoke(u.origin,'/v1/lab/prospective-seal',common,env,ctx);
 if(second.status>=400||second.data?.ok===false){
  return{status:500,data:{ok:false,version:VERSION,stage:'prelock-orchestrator',mode:'seal',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,sealWritten:true,verificationComplete:false,error:'seal was written but idempotent verification call failed',firstSeal:{snapshotSha256:first.data?.seal?.snapshotSha256||null,sealKind:first.data?.seal?.sealKind||null}}};
 }
 const identity=verifySealIdentity(first.data,second.data);
 if(!identity.ok){
  return{status:500,data:{ok:false,version:VERSION,stage:'prelock-orchestrator',mode:'seal',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,sealWritten:true,verificationComplete:false,error:'immutable seal identity verification failed',sealIdentity:identity}};
 }
 return{status:200,data:{
  ok:true,version:VERSION,stage:'prelock-orchestrator',mode:'seal',target:{date,venue,raceNo,trackAssumption:track},build:buildSummary,readiness:readinessSummary,
  sealWritten:true,verificationComplete:true,sealIdentity:identity,
  seal:{snapshotSha256:identity.firstHash,sealKind:first.data?.seal?.sealKind||second.data?.seal?.sealKind||null,sealedAt:first.data?.seal?.sealedAt||second.data?.seal?.sealedAt||null,futureDayLock:Boolean(first.data?.seal?.futureDayLock??second.data?.seal?.futureDayLock),prospectiveValidationCreditEligible:Boolean(first.data?.seal?.prospectiveValidationCreditEligible??second.data?.seal?.futureDayLock)},
  guardrails:{explicitTrackRequired:true,confirmLockRequired:true,buildBeforeReadiness:true,readinessRequiredGreen:true,doubleSealCall:true,secondCallMustBeIdempotent:true,identicalSha256Required:true,automaticWeightMutation:false},
  next:'Keep this hash untouched. After the race, ingest official outcomes and score this exact prospectively locked snapshot.'
 }};
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'one-call prelock prepare/seal orchestration'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'prelock-orchestrator-double-hash-verification',now:new Date().toISOString()});
  if(u.pathname==='/v1/lab/prelock-run'){
   try{const result=await prelockRun(request,env,ctx);return json(result.data,result.status)}catch(error){return json({ok:false,version:VERSION,error:String(error)},500)}
  }
  return app.fetch(request,env,ctx);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
