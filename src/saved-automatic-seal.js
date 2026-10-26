import {AUTOMATIC_MODEL} from './automatic-pre-race-prediction.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {featureCapturedBeforeOfficialStart} from './learning-experiment-v3.40.0.js';
import {sha256} from './card-evidence.js';
import {prepareSavedAutomaticSealInput} from './saved-automatic-seal-input.js';
import {ensureProspectiveSealTables,ensureSealGuards,writeAtomicSeal} from './prospective-seal-store.js';
const KIND='saved-automatic-v1',TRACK='not-assessed';

// Local adapter only. No endpoint or scheduled handler imports this module.
// Existing seal tables and their atomic two-row writer are reused; no scoring.
async function ensureSavedAutomaticGuards(db){
 for(const table of ['lab_model_locks','lab_prospective_seals'])for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS ${table}_saved_automatic_no_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN OLD.model_version='${AUTOMATIC_MODEL}' BEGIN SELECT RAISE(ABORT,'saved automatic seals are immutable'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS saved_automatic_requires_original BEFORE INSERT ON lab_model_locks
 WHEN NEW.model_version='${AUTOMATIC_MODEL}' AND (NEW.seal_kind IS NOT '${KIND}' OR NEW.track_condition IS NOT '${TRACK}' OR NOT EXISTS (
 SELECT 1 FROM lab_automatic_predictions_v1 a JOIN jra_races r ON r.race_key=json_extract(a.snapshot_json,'$.race.storedCardKey')
 JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no
 JOIN lab_card_source_evidence e ON e.race_key=r.race_key
 WHERE r.race_key=NEW.race_key AND a.snapshot_json=NEW.snapshot_json
 AND a.race_key=r.race_date||':'||r.venue||':'||r.race_no AND a.saved_at=json_extract(NEW.snapshot_json,'$.savedAt')
 AND julianday(NEW.sealed_at)>=julianday(a.saved_at)
 AND (p.source_url LIKE 'https://www.jra.go.jp/%' OR p.source_url LIKE 'https://jra.go.jp/%' OR p.source_url LIKE 'https://www.jra.jp/%' OR p.source_url LIKE 'https://jra.jp/%')
 AND julianday(NEW.sealed_at)<julianday(p.race_date||'T'||p.start_time||':00+09:00')-5.0/1440
 AND e.card_fetched_at=r.fetched_at AND e.horse_numbers_observed=1 AND e.frames_observed=1
 AND e.declared_count=r.runner_count AND e.source_row_count=r.runner_count AND e.parsed_count=r.runner_count
 AND r.runner_count=json_array_length(a.snapshot_json,'$.card')
 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners rr WHERE rr.race_key=r.race_key)
 AND NOT EXISTS(SELECT 1 FROM json_each(a.snapshot_json,'$.card') c WHERE NOT EXISTS(
 SELECT 1 FROM jra_runners rr WHERE rr.race_key=r.race_key AND rr.horse_no=json_extract(c.value,'$.horse_no')
 AND rr.frame_no=json_extract(c.value,'$.frame_no') AND rr.horse_name=json_extract(c.value,'$.horse_name') AND rr.age IS json_extract(c.value,'$.age')))
 AND NOT EXISTS(SELECT 1 FROM lab_race_outcomes o WHERE o.race_key=r.race_key AND o.finish_position IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM lab_race_result_details d WHERE d.race_key=r.race_key)
 )) BEGIN SELECT RAISE(ABORT,'saved automatic prediction or pre-race evidence changed'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS saved_automatic_metadata_matches BEFORE INSERT ON lab_prospective_seals
 WHEN NEW.model_version='${AUTOMATIC_MODEL}' AND (NEW.seal_kind IS NOT '${KIND}' OR NEW.track_condition IS NOT '${TRACK}' OR NEW.outcome_count_at_seal<>0 OR NOT EXISTS(
 SELECT 1 FROM lab_model_locks l JOIN lab_automatic_predictions_v1 a ON a.snapshot_json=l.snapshot_json
 WHERE l.race_key=NEW.race_key AND l.model_version=NEW.model_version AND l.track_condition=NEW.track_condition
 AND l.seal_kind=NEW.seal_kind AND l.sealed_at=NEW.sealed_at AND a.race_date=NEW.race_date
 AND a.snapshot_sha256=NEW.snapshot_sha256 AND json_extract(a.snapshot_json,'$.race.runnerCount')=NEW.runner_count
 AND EXISTS(SELECT 1 FROM lab_card_source_evidence e WHERE e.race_key=NEW.race_key
 AND e.source_sha256=json_extract(NEW.quality_json,'$.cardEvidence.source_sha256')
 AND e.runner_sha256=json_extract(NEW.quality_json,'$.cardEvidence.runner_sha256')
 AND e.card_fetched_at=json_extract(NEW.quality_json,'$.cardEvidence.card_fetched_at'))
 )) BEGIN SELECT RAISE(ABORT,'saved automatic seal metadata mismatch'); END`).run();
}

export async function readSavedAutomaticSeal(db,input,{includePending=false}={}){
 const t=targetInput(input);let row;
 try{row=await db.prepare(`SELECT a.snapshot_json original_json,a.snapshot_sha256 original_sha,a.saved_at,l.id lock_id,l.snapshot_json,l.sealed_at,s.id seal_id,s.snapshot_sha256,s.sealed_at metadata_sealed_at,s.runner_count,s.quality_json FROM lab_automatic_predictions_v1 a JOIN lab_model_locks l ON l.race_key=json_extract(a.snapshot_json,'$.race.storedCardKey') AND l.model_version=? AND l.track_condition=? AND l.seal_kind=? LEFT JOIN lab_prospective_seals s ON s.race_key=l.race_key AND s.model_version=l.model_version AND s.track_condition=l.track_condition AND s.seal_kind=l.seal_kind WHERE a.race_key=? LIMIT 1`).bind(AUTOMATIC_MODEL,TRACK,KIND,`${t.date}:${t.venue}:${t.raceNo}`).first();}
 catch(e){if(!/no such table/.test(String(e)))throw e;row=null;}
 if(!row){
  if(!includePending)return{ok:true,available:false,locked:false};
  let receipt;try{receipt=await db.prepare("SELECT json_extract(detail_json,'$.savedAutomaticLock') lock_json FROM lab_automatic_prediction_receipts_v1 WHERE race_key=?").bind(`${t.date}:${t.venue}:${t.raceNo}`).first();}catch(e){if(!/no such table/.test(String(e)))throw e;}
  return{ok:true,available:false,locked:false,pending:receipt?.lock_json?JSON.parse(receipt.lock_json):null};
 }
 const snapshot=JSON.parse(row.snapshot_json),actual=await sha256(row.snapshot_json);
 if(!row.seal_id||row.snapshot_json!==row.original_json||actual!==row.original_sha||actual!==row.snapshot_sha256||row.sealed_at!==row.metadata_sealed_at||row.runner_count!==snapshot.runners.length||Date.parse(row.sealed_at)<Date.parse(row.saved_at)||!await featureCapturedBeforeOfficialStart(db,t,Date.parse(row.sealed_at)))throw Error('Saved automatic seal provenance mismatch');
 return{ok:true,available:true,locked:true,integrityVerified:true,preRaceVerified:true,lockId:row.lock_id,sealId:row.seal_id,modelVersion:AUTOMATIC_MODEL,sealKind:KIND,predictionSavedAt:row.saved_at,lockedAt:row.sealed_at,snapshotSha256:actual,snapshot,quality:JSON.parse(row.quality_json)};
}

export async function sealSavedAutomaticPrediction(db,input,{now=Date.now}={}){
 const old=await readSavedAutomaticSeal(db,input);if(old.available)return{...old,idempotent:true,written:0};
 const ready=await prepareSavedAutomaticSealInput(db,input,now());if(!ready.eligible)return ready;
 await ensureProspectiveSealTables(db);await ensureSealGuards(db);await ensureSavedAutomaticGuards(db);
 const snapshot=JSON.parse(ready.snapshotJson),sealedAt=new Date(now()).toISOString();
 const quality={source:'saved-automatic-prediction',sourceSnapshotSha256:ready.predictionSha256,scoreRecomputed:false,humanMarksUsed:false,validationCreditEligible:false,automaticPromotion:false,cardEvidence:ready.cardEvidence};
 try{
  await writeAtomicSeal(db,{raceKey:snapshot.race.storedCardKey,date:snapshot.race.date,modelVersion:AUTOMATIC_MODEL,track:TRACK,sealKind:KIND,weights:{},snapshotJson:ready.snapshotJson,hash:ready.predictionSha256,runnerCount:ready.runnerCount,futureDayLock:snapshot.race.date>new Date(Date.parse(sealedAt)+9*3600000).toISOString().slice(0,10),quality,sealedAt});
  const read=await readSavedAutomaticSeal(db,input);if(!read.available||read.snapshotSha256!==ready.predictionSha256)throw Error('Saved automatic seal independent readback unavailable');
  return{...read,idempotent:false,written:1};
 }catch(e){e.saveMayHaveSucceeded=true;e.retryWrite=false;throw e;}
}
