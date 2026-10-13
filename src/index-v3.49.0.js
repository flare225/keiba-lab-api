import app from './index-v3.48.2.js';
import {markRecordProvenance} from './mark-record-provenance.js';
import {workoutEndpoint} from './workout-evidence-v3.49.0.js';
export const VERSION='3.49.4';
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
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
  if(data&&typeof data==='object')data.version=VERSION;
  if(response.ok&&request.method==='GET'&&u.pathname==='/v1/lab/user-marks'&&Array.isArray(data?.latest)){
   for(const revision of data.latest){
    try{
     const stored=await env.DB.prepare('SELECT audit_json,audit_sha256,created_at FROM lab_user_mark_revisions WHERE revision_id=? AND race_key=? AND phase=?').bind(revision.revisionId,data.raceKey,revision.phase).first();
     revision.provenance=await markRecordProvenance({...revision,createdAt:stored?.created_at,auditJson:stored?.audit_json,auditSha256:stored?.audit_sha256},u.searchParams.get('date'));
    }catch{
     revision.provenance={status:'provenance-unavailable',integrityVerified:false,recordedBeforeRaceDay:false,preRaceLock:false,validationCreditEligible:false};
    }
   }
  }
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}
};
