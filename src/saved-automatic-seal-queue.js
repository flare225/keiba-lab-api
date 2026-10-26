import {AUTOMATIC_MODEL} from './automatic-pre-race-prediction.js';
import {readSavedAutomaticSeal,sealSavedAutomaticPrediction} from './saved-automatic-seal.js';
import {jstDay} from './history-collection-v3.37.0.js';
const quota=e=>e?.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e));

// Proposed opt-in connection to the existing three-minute scheduler. Disabled
// unless separately approved; no new timer/table/source request or rescoring.
export async function scheduledSavedAutomaticSeal(db,{enabled=false,now=Date.now}={}){
 if(!enabled)return{ok:true,status:'disabled',sealed:0,externalRequests:0};
 const stamp=now(),today=jstDay(stamp),since=new Date(Date.parse(today+'T00:00:00Z')-7*86400000).toISOString().slice(0,10),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);let row;
 try{row=await db.prepare(`SELECT a.race_key,a.snapshot_sha256,p.race_date AS date,p.venue,p.race_no AS raceNo,json_extract(c.detail_json,'$.savedAutomaticLock') previous_lock FROM lab_automatic_predictions_v1 a JOIN jra_race_program p ON p.program_key=a.race_key JOIN lab_automatic_prediction_receipts_v1 c ON c.race_key=a.race_key AND c.status='saved' WHERE a.race_date BETWEEN ? AND ? AND (json_extract(c.detail_json,'$.savedAutomaticLock.status')='pending-readback' OR (a.race_date>=? AND datetime(p.race_date||'T'||p.start_time||':00+09:00')>datetime(?,'unixepoch','+5 minutes'))) AND COALESCE(json_extract(c.detail_json,'$.savedAutomaticLock.nextAttemptAtMs'),0)<=? AND (json_extract(c.detail_json,'$.savedAutomaticLock.status')='pending-readback' OR NOT EXISTS(SELECT 1 FROM lab_prospective_seals s WHERE s.race_key=json_extract(a.snapshot_json,'$.race.storedCardKey') AND s.model_version=? AND s.track_condition='not-assessed' AND s.seal_kind='saved-automatic-v1')) ORDER BY CASE WHEN a.race_date>=? THEN 0 ELSE 1 END,a.race_date,p.start_time,a.race_key LIMIT 1`).bind(since,until,today,stamp/1000,stamp,AUTOMATIC_MODEL,today).first();}
 catch(e){if(!/no such table/.test(String(e)))throw e;return{ok:false,status:'seal-store-unavailable',sealed:0,retryWrite:false,externalRequests:0};}
 if(!row)return{ok:true,status:'no-due-saved-prediction',sealed:0,externalRequests:0};
 const target={date:row.date,venue:row.venue,raceNo:row.raceNo},previous=row.previous_lock?JSON.parse(row.previous_lock):null;let result;
 try{
  // Uncertain writes can only be reconciled by READ, never blindly rewritten.
  if(previous?.status==='pending-readback'){
   const read=await readSavedAutomaticSeal(db,target);result=read.available?{...read,written:0,verificationOnly:true}:{ok:false,locked:false,status:'pending-readback',retryWrite:false};
  }else result=await sealSavedAutomaticPrediction(db,target,{now});
 }catch(e){if(quota(e))throw e;result={ok:false,locked:false,status:e.saveMayHaveSucceeded?'pending-readback':'blocked',error:String(e.message||e),retryWrite:false};}
 const nextAttemptAtMs=now()+3600000,record={status:result.locked?'saved':result.status||'blocked',predictionSha256:row.snapshot_sha256,checkedAt:new Date(now()).toISOString(),nextAttemptAtMs,nextAttemptAt:new Date(nextAttemptAtMs).toISOString(),...(result.locked?{lockId:result.lockId,lockedAt:result.lockedAt}:{error:result.error||null,retryWrite:false})};
 // Preserve the original saved prediction receipt, its status and its clock.
 await db.prepare(`UPDATE lab_automatic_prediction_receipts_v1 SET detail_json=json_set(detail_json,'$.savedAutomaticLock',json(?)) WHERE race_key=? AND status='saved'`).bind(JSON.stringify(record),row.race_key).run();
 return{ok:result.locked===true,status:record.status,target,sealed:Number(result.written)||0,verificationOnly:result.verificationOnly===true,lockId:result.lockId||null,predictionSha256:row.snapshot_sha256,nextAttemptAt:record.nextAttemptAt,error:record.error||null,externalRequests:0};
}
