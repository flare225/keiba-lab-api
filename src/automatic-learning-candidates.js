import {readAutomaticPrediction} from './automatic-pre-race-prediction.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {resultWindowOpen,resultSourceMeta} from './official-result-sources-v3.39.0.js';
import {sha256} from './card-evidence.js';
import {jstDay} from './history-collection-v3.37.0.js';
const TABLE='lab_automatic_learning_candidates_v1',CHECKS='lab_automatic_candidate_checks_v1';
const terminals=new Set(['scratched','excluded','did-not-finish','disqualified']);
export const AUTOMATIC_COHORT='automatic-prospective-reference-v1';
async function ensure(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(race_key TEXT PRIMARY KEY,prediction_sha256 TEXT NOT NULL,record_json TEXT NOT NULL,record_sha256 TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${CHECKS}(race_key TEXT PRIMARY KEY,next_check_at INTEGER NOT NULL,status TEXT NOT NULL,detail_json TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS automatic_candidate_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'automatic learning candidate is immutable'); END`).run();
}
export async function readAutomaticLearningCandidate(db,input,{includeOriginal=false}={}){
 const t=targetInput(input),key=`${t.date}:${t.venue}:${t.raceNo}`;let row;
 try{row=await db.prepare(`SELECT * FROM ${TABLE} WHERE race_key=?`).bind(key).first()}catch(e){if(/no such table/.test(String(e)))return{ok:true,available:false};throw e}
 if(!row)return{ok:true,available:false};
 if(await sha256(row.record_json)!==row.record_sha256)throw Error('自動学習候補のハッシュが一致しません。');
 const prediction=await readAutomaticPrediction(db,t),record=JSON.parse(row.record_json);
 if(!prediction.integrityVerified||prediction.snapshotSha256!==row.prediction_sha256||record.predictionSha256!==row.prediction_sha256||record.raceKey!==key||record.modelVersion!==prediction.snapshot.modelVersion||record.createdAt!==row.created_at||record.cohort!==AUTOMATIC_COHORT)throw Error('自動事前予想と学習候補の対応が一致しません。');
 return{ok:true,available:true,integrityVerified:true,labelSha256:row.record_sha256,record,...(includeOriginal?{originalPrediction:prediction.snapshot}:{})};
}
export async function labelAutomaticPrediction(db,input,now=Date.now()){
 const t=targetInput(input),old=await readAutomaticLearningCandidate(db,t);if(old.available)return{...old,saved:0,externalRequests:0};
 const prediction=await readAutomaticPrediction(db,t);if(!prediction.available)return{ok:true,status:'awaiting-pre-race-prediction',saved:0,externalRequests:0};
 const s=prediction.snapshot,n=s.runners?.length;
 if(!s.modelVersion||!n||n!==s.race.runnerCount||n!==s.card?.length||new Set(s.runners.map(r=>r.horseNo)).size!==n||s.guardrails.humanMarksUsed!==false||s.guardrails.targetResultUsed!==false||s.guardrails.immutable!==true||s.runners.some(r=>!Number.isFinite(r.score)||r.score<0||r.score>100||!Number.isInteger(r.rank)||r.rank<1||r.rank>n||!s.card.some(c=>Number(c.horse_no)===r.horseNo&&c.horse_name===r.horseName)))throw Error('全馬の独立事前評価を確認できません。');
 if(!await resultWindowOpen(db,t.date,t.venue,t.raceNo,now))return{ok:true,status:'awaiting-result-window',saved:0,externalRequests:0};
 const results=(await db.prepare('SELECT horse_no,horse_name,finish_position,finish_status,source_url,source_sha256 FROM lab_race_result_details WHERE race_key=? ORDER BY horse_no').bind(s.race.storedCardKey).all()).results||[];
 if(results.length!==n||new Set(results.map(r=>Number(r.horse_no))).size!==n||!results.some(r=>r.finish_status==='finished'&&r.finish_position===1))return{ok:true,status:'awaiting-complete-official-results',saved:0,externalRequests:0};
 if(new Set(results.map(r=>r.source_url)).size!==1||new Set(results.map(r=>r.source_sha256)).size!==1)throw Error('公式結果の出典が一致しません。');
 const rows=s.runners.map(r=>{
  const result=results.find(x=>Number(x.horse_no)===r.horseNo&&x.horse_name===r.horseName),meta=resultSourceMeta(result?.source_url);
  if(!result||!meta||meta.date!==t.date||meta.venue!==t.venue||meta.raceNo!==t.raceNo||!/^[a-f0-9]{64}$/.test(result.source_sha256||'')||!(result.finish_status==='finished'&&Number.isInteger(result.finish_position)&&result.finish_position>=1&&result.finish_position<=n||terminals.has(result.finish_status)&&result.finish_position===null))throw Error('公式結果の馬名・着順・出典を確認できません。');
  return{horseNo:r.horseNo,horseName:r.horseName,referenceScore:r.score,referenceRank:r.rank,referenceMark:r.mark,components:r.assessment?.components||null,runningStyle:r.assessment?.runningStyle||null,finishPosition:result.finish_position,finishStatus:result.finish_status};
 });
 const record={cohort:AUTOMATIC_COHORT,raceKey:s.race.raceKey,modelVersion:s.modelVersion,predictionSha256:prediction.snapshotSha256,predictionSavedAt:s.savedAt,resultSha256:await sha256(JSON.stringify(results)),resultSourceUrl:results[0].source_url,resultSourceSha256:results[0].source_sha256,createdAt:new Date(now).toISOString(),rows,guardrails:{originalScoresPreserved:true,postRaceReconstruction:false,humanMarksRequired:false,automaticTraining:false,automaticPromotion:false,frozenExperimentModified:false,accuracyImprovementValidated:false}};
 const body=JSON.stringify(record),hash=await sha256(body);await ensure(db);
 try{
 const inserted=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?,?,?)`).bind(record.raceKey,prediction.snapshotSha256,body,hash,record.createdAt).run();
 const read=await readAutomaticLearningCandidate(db,t);if(!read.integrityVerified)throw Error('学習候補の独立読み返しに失敗しました。');
 if(Number(inserted.meta?.changes)&&read.labelSha256!==hash)throw Error('学習候補の保存内容が一致しません。');
 return{...read,saved:Number(inserted.meta?.changes)||0,externalRequests:0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
export async function scheduledAutomaticCandidates(db,now=Date.now()){
 await ensure(db);const today=jstDay(now);let row;
 try{row=await db.prepare(`SELECT a.snapshot_json FROM lab_automatic_predictions_v1 a LEFT JOIN ${TABLE} l ON l.race_key=a.race_key LEFT JOIN ${CHECKS} c ON c.race_key=a.race_key WHERE a.race_date<=? AND l.race_key IS NULL AND COALESCE(c.next_check_at,0)<=? ORDER BY COALESCE(c.next_check_at,0),a.race_date,a.race_key LIMIT 1`).bind(today,now).first()}catch(e){if(/no such table/.test(String(e)))return{ok:true,status:'no-saved-automatic-prediction',saved:0,externalRequests:0};throw e}
 if(!row)return{ok:true,status:'no-due-automatic-candidate',saved:0,externalRequests:0};
 const race=JSON.parse(row.snapshot_json).race;let result;
 try{result=await labelAutomaticPrediction(db,race,now)}catch(e){if(e.saveMayHaveSucceeded)throw e;result={ok:false,status:'deferred',error:String(e.message||e),saved:0,externalRequests:0}}
 await db.prepare(`INSERT INTO ${CHECKS} VALUES(?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET next_check_at=excluded.next_check_at,status=excluded.status,detail_json=excluded.detail_json`).bind(race.raceKey,now+3600000,result.available?'labelled':result.status,JSON.stringify(result.available?{labelSha256:result.labelSha256}:result)).run();return{...result,raceKey:race.raceKey};
}
