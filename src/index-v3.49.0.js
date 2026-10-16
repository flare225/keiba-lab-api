import {verifyEditorialClaims} from './editorial-claim-verification.js';
import {seedEditorialReferences,readEditorialReferences,editorialReferencePage} from './editorial-reference-notes.js';
import {scheduledReadStatus,runWithScheduledReadBudget,scheduledBudgetLane} from './scheduled-read-budget.js';
import {COLLECTION_READ_POLICY,shouldRunScheduled} from './collection-read-policy.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
import {priorDetailStatus,collectPriorDetails,scheduledPriorDetails} from './prior-result-details.js';
import {collectLockedMarkResults,readLockedMarkResults} from './locked-mark-result-evidence.js';
import {userMarkLockEndpoint,readUserMarkLock} from './user-mark-lock.js';
import app from './index-v3.48.2.js';
import {markRecordProvenance} from './mark-record-provenance.js';
import {workoutEndpoint} from './workout-evidence-v3.49.0.js';
export const VERSION='3.49.29';
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(['/v1/lab/race-reference-notes','/lab/race-reference-notes'].includes(u.pathname)){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   if(request.method!=='GET')return Response.json({ok:false,error:'read-only endpoint',version:VERSION},{status:405,headers});
   try{const data=await readEditorialReferences(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});return u.pathname.startsWith('/v1/')?Response.json({...data,version:VERSION},{headers}):new Response(editorialReferencePage(data),{headers:{...headers,'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff'}});}catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:/登録がない/.test(String(e))?404:/照合できません/.test(String(e))?409:503,headers});}
  }
  if(u.pathname==='/v1/lab/collection-read-policy'&&request.method==='GET')return Response.json({ok:true,version:VERSION,policy:COLLECTION_READ_POLICY},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  if(u.pathname==='/v1/lab/scheduled-read-budget'&&request.method==='GET'){
   try{return Response.json({ok:true,version:VERSION,budget:await scheduledReadStatus(env.DB)},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});}catch{return Response.json({ok:false,version:VERSION,error:'DB読み取り予算を確認できません。定期処理は予算確認に成功するまで実行しません。'},{status:503,headers:{'cache-control':'no-store'}});}
  }
  if(u.pathname==='/v1/lab/prior-result-details'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    let data;
    if(request.method==='GET')data=await priorDetailStatus(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});
    else if(request.method==='POST'){
     const input=await request.json();if(input.confirm!=='COLLECT')throw Error('confirm COLLECT が必要です。');
     data=await runPipelineJob(env.DB,'prior-details','manual',()=>collectPriorDetails(env.DB,input));
    }else return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    return Response.json({...data,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:400,headers})}
  }
  if(u.pathname==='/v1/lab/locked-mark-results'&&request.method==='GET'){
   const date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),no=Number(u.searchParams.get('race_no')),phase=u.searchParams.get('phase');
   const valid=/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&venue&&venue.length<=30&&Number.isInteger(no)&&no>=1&&no<=12&&['final','post_draw'].includes(phase);
   try{return Response.json(valid?{ok:true,version:VERSION,evidence:await readLockedMarkResults(env.DB,date+':'+venue+':'+no,phase)}:{ok:false,error:'invalid race',version:VERSION},{status:valid?200:400,headers:{'cache-control':'no-store'}})}catch{return Response.json({ok:false,error:'evidence integrity unverified',version:VERSION},{status:409})}
  }
  if(u.pathname==='/v1/lab/user-mark-lock'){const r=await userMarkLockEndpoint(request,env);return new Response(JSON.stringify({...await r.json(),version:VERSION}),{status:r.status,headers:r.headers});}
  if(u.pathname==='/v1/lab/user-mark-token-check'&&request.method==='GET'){
   const ready=typeof env.USER_MARK_WRITE_TOKEN==='string'&&env.USER_MARK_WRITE_TOKEN.length>=24;
   const tokenMatch=ready&&request.headers.get('authorization')===`Bearer ${env.USER_MARK_WRITE_TOKEN}`;
   return new Response(JSON.stringify({ok:tokenMatch,tokenMatch,writeReady:ready,mode:'no-write',version:VERSION}),{
    status:!ready?503:tokenMatch?200:401,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
   });
  }
  if(u.pathname==='/v1/lab/workouts'||u.pathname==='/v1/lab/workouts/sync'){
   const response=await workoutEndpoint(request,env);
   const data=await response.json();
   return new Response(JSON.stringify({...data,version:VERSION}),{status:response.status,headers:response.headers});
  }
  const response=await app.fetch(request,env,ctx);
  let data;try{data=await response.clone().json();}catch{return response;}
  if(data&&typeof data==='object'){data.version=VERSION;if(u.pathname==='/v1/lab/work-progress'){data.readPolicy=COLLECTION_READ_POLICY;try{data.scheduledReadBudget=await scheduledReadStatus(env.DB);}catch{data.scheduledReadBudget=null;}}}
  if(response.ok&&request.method==='GET'&&u.pathname==='/v1/lab/user-marks'&&Array.isArray(data?.latest)){
   for(const revision of data.latest){
    try{
     const stored=await env.DB.prepare('SELECT audit_json,audit_sha256,created_at FROM lab_user_mark_revisions WHERE revision_id=? AND race_key=? AND phase=?').bind(revision.revisionId,data.raceKey,revision.phase).first();
     revision.userLock=['post_draw','final'].includes(revision.phase)?await readUserMarkLock(env.DB,data.raceKey,revision.phase):null;
     revision.provenance=await markRecordProvenance({...revision,createdAt:stored?.created_at,auditJson:stored?.audit_json,auditSha256:stored?.audit_sha256},u.searchParams.get('date'));
    }catch{
     revision.provenance={status:'provenance-unavailable',integrityVerified:false,recordedBeforeRaceDay:false,preRaceLock:false,validationCreditEligible:false};
    }
   }
  }
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 },
 async scheduled(event,env,ctx){
  if(!shouldRunScheduled(event))return;
  return runWithScheduledReadBudget(env.DB,async db=>{
  const budgetEnv={...env,DB:db};
  try{await seedEditorialReferences(db);await verifyEditorialClaims(db);}catch{console.warn('editorial reference seed unavailable');}
  if(event.cron==='*/3 * * * *'&&Math.floor(Number(event.scheduledTime)/60000)%12===0){
   try{await runPipelineJob(db,'prior-details','scheduled',()=>scheduledPriorDetails(db),{scheduledTime:event.scheduledTime});}catch{ /* Failure is recorded; existing collection jobs must still run. */ }
  }
  await app.scheduled(event,budgetEnv,ctx);await collectLockedMarkResults(db);
  },Date.now,scheduledBudgetLane(event));
 }
};
