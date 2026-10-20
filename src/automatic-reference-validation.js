import {readAutomaticTraining,readVerifiedAutomaticExample} from './automatic-reference-training.js';
import {BASE_WEIGHTS,pairwiseConcordance} from './learning-experiment-v3.40.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {jstDay} from './history-collection-v3.37.0.js';
import {sha256} from './card-evidence.js';
const TABLE='lab_automatic_shadow_validation_v1';
export function validateAutomaticValidationInput(input){
 if(!/^[a-f0-9]{64}$/.test(input.runSha256||'')||!Array.isArray(input.targets)||!input.targets.length||input.targets.length>100)throw Error('学習ハッシュと1〜100レースを指定してください。');
 const targets=input.targets.map(targetInput),keys=targets.map(t=>`${t.date}:${t.venue}:${t.raceNo}`);
 if(new Set(keys).size!==keys.length)throw Error('検証対象が重複しています。');return{targets,keys};
}
export async function readAutomaticValidation(db,hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('検証記録のハッシュを指定してください。');
 let row;try{row=await db.prepare(`SELECT record_json,created_at FROM ${TABLE} WHERE validation_sha256=?`).bind(hash).first();}catch(e){if(/no such table/.test(String(e)))return{ok:true,available:false};throw e;}
 if(!row)return{ok:true,available:false};if(await sha256(row.record_json)!==hash)throw Error('検証記録ハッシュが一致しません。');
 const record=JSON.parse(row.record_json),training=await readAutomaticTraining(db,record.trainingRunSha256);
 if(!training.integrityVerified||record.guardrails?.automaticPromotion!==false)throw Error('学習記録との対応が一致しません。');
 return{ok:true,available:true,integrityVerified:true,validationSha256:hash,createdAt:row.created_at,record};
}
export async function validateAutomaticReferences(db,input,now=Date.now()){
 const {targets,keys}=validateAutomaticValidationInput(input),training=await readAutomaticTraining(db,input.runSha256),r=training.record;
 if(!training.integrityVerified||r.status!=='fitted-shadow-only'||!r.candidate||!Number.isFinite(Date.parse(training.createdAt)))throw Error('条件を満たす保存済みshadow候補が必要です。');
 const weights=r.candidate.weights,weightKeys=Object.keys(BASE_WEIGHTS);
 if(!weights||Object.keys(weights).length!==weightKeys.length||weightKeys.some(k=>!Number.isFinite(weights[k])||weights[k]<=0)||weightKeys.reduce((n,k)=>n+weights[k],0)!==weightKeys.reduce((n,k)=>n+BASE_WEIGHTS[k],0))throw Error('候補の重みが不正です。');
 if(targets.some((t,i)=>t.date<r.protocol.validationFrom||t.date>=jstDay(now)||r.evidence.some(e=>e.raceKey===keys[i])))throw Error('検証期間外・未終了日または学習に使用したレースです。');
 const races=[];
 for(let i=0;i<targets.length;i++){
  const example=await readVerifiedAutomaticExample(db,targets[i]);
  if(example.label.modelVersion!==r.sourceModel||Date.parse(example.original.savedAt)<=Date.parse(training.createdAt))throw Error('学習後に保存した同一モデルの事前予想が必要です。');
  const baseline=pairwiseConcordance(example.rows,BASE_WEIGHTS),candidate=pairwiseConcordance(example.rows,weights);
  races.push({...example.evidence,date:targets[i].date,baselineConcordance:baseline,candidateConcordance:candidate});
 }
 races.sort((a,b)=>a.raceKey.localeCompare(b.raceKey));const days=new Set(races.map(x=>x.date)).size,ready=races.length>=r.protocol.minimumValidationRaces&&days>=r.protocol.minimumValidationDays;
 const mean=k=>races.reduce((n,x)=>n+x[k],0)/races.length;
 const record={trainingRunSha256:input.runSha256,sourceModel:r.sourceModel,protocol:r.protocol,status:ready?'ready-for-review':'awaiting-validation-data',validationRaces:races.length,validationDays:days,baselineConcordance:mean('baselineConcordance'),candidateConcordance:mean('candidateConcordance'),races,guardrails:{automaticPromotion:false,canReviewCandidate:ready,accuracyImprovementValidated:false,originalScoresPreserved:true,scoresRecomputedFromFrozenPreRaceFeatures:true,candidatePredictionLockedBeforeRace:false,userLocksModified:false,frozenExperimentModified:false}};
 const body=JSON.stringify(record),hash=await sha256(body);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(validation_sha256 TEXT PRIMARY KEY,record_json TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS automatic_validation_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'automatic shadow validation is immutable'); END`).run();
 try{const result=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?)`).bind(hash,body,new Date(now).toISOString()).run();const read=await readAutomaticValidation(db,hash);if(!read.integrityVerified||JSON.stringify(read.record)!==body)throw Error('検証記録の読み返しが一致しません。');return{...read,saved:Number(result.meta?.changes)||0,externalRequests:0};}catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
