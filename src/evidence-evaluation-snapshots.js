import {sha256} from './card-evidence.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {rosterHistoryInventory} from './roster-history-inventory.js';
import {HISTORY_VALUE_POLICY} from './history-value-normalization.js';
const table='lab_evidence_evaluations_v1';
const key=t=>`${t.date}:${t.venue}:${t.raceNo}`;
export async function readEvidenceEvaluation(db,input){
 const t=targetInput(input);let row;
 try{row=await db.prepare(`SELECT * FROM ${table} WHERE race_key=?`+(input.sha256?' AND evaluation_sha256=?':'')+' ORDER BY saved_at DESC,rowid DESC LIMIT 1').bind(key(t),...(input.sha256?[input.sha256]:[])).first();}catch(e){if(/no such table/i.test(String(e)))return{ok:true,available:false};throw e;}
 if(!row)return{ok:true,available:false};
 if(await sha256(row.snapshot_json)!==row.evaluation_sha256)throw Error('検証評価版のハッシュが一致しません。');
 const s=JSON.parse(row.snapshot_json);if(key(s.race)!==key(t)||s.phase!=='shadow-comparison'||s.savedAt!==row.saved_at||s.modelVersion!==row.model_version||s.sourceFingerprint!==row.source_fingerprint||s.guardrails?.formalLock!==false||s.guardrails?.automaticPromotion!==false||s.guardrails?.eligibleForLearning!==false)throw Error('検証評価版の対象・保存状態が一致しません。');
 return{ok:true,available:true,integrityVerified:true,snapshotSha256:row.evaluation_sha256,snapshot:s};
}
export async function saveEvidenceEvaluation(db,input,now=Date.now(),inventory=rosterHistoryInventory){
 const t=targetInput(input),today=new Date(now+9*3600000).toISOString().slice(0,10);if(t.date<=today)throw Error('新しい検証評価版は翌日以降の対象に限定します。');
 const data=await inventory(db,{from:t.date,to:t.date,asOf:new Date(now).toISOString(),raceKey:key(t)},now);
 const current=data.currentShadowEvaluations?.[0],baseline=data.savedPredictions?.[0],roster=data.races?.[0];
 if(data.races?.length!==1||roster.raceKey!==key(t)||!current||key(current.race)!==key(t)||!baseline||current.horses.length!==roster.horseCount||!current.horses.length||current.horses.length>100||new Set(current.horses.map(h=>h.horseName)).size!==current.horses.length||current.policy?.productionEnabled!==false)throw Error('対象の旧予想と検証モデルを確認できません。');
 const modelVersion=current.policy.model,sourceFingerprint=await sha256(JSON.stringify({rosterSnapshotId:roster.rosterSnapshotId,baselineSha256:baseline.sha256,candidate:current}));
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${table}(evaluation_sha256 TEXT PRIMARY KEY,race_key TEXT NOT NULL,model_version TEXT NOT NULL,source_fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,saved_at TEXT NOT NULL,UNIQUE(race_key,model_version,source_fingerprint))`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS evidence_evaluation_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'evaluation snapshot is immutable'); END`).run();
 const old=await db.prepare(`SELECT evaluation_sha256 FROM ${table} WHERE race_key=? AND model_version=? AND source_fingerprint=?`).bind(key(t),modelVersion,sourceFingerprint).first();
 if(old)return{...await readEvidenceEvaluation(db,{...t,sha256:old.evaluation_sha256}),saved:0};
 const snapshot={phase:'shadow-comparison',race:current.race,savedAt:new Date(now).toISOString(),modelVersion,historyInterpretationVersion:HISTORY_VALUE_POLICY,sourceFingerprint,rosterSnapshotId:roster.rosterSnapshotId,baseline:{snapshotSha256:baseline.sha256,savedAt:baseline.savedAt,model:baseline.model},candidate:current,
  runners:current.horses.map(h=>{const old=baseline.horseUsage.find(r=>r.horseName===h.horseName);if(!old)throw Error('旧予想と検証評価の馬名が一致しません。');return{horseName:h.horseName,horseNo:null,frameNo:null,oldRank:old.rank,oldScore:old.score,oldMark:old.mark,newRank:h.rank,newScore:h.score,newMark:h.rank==null?null:({1:"◎",2:"○",3:"▲",4:"△",5:"☆"}[h.rank]||"－"),primaryUsedRows:h.primaryInput.length,courseUsedRows:h.courseInput.length,contributions:h.contributions,runningStyle:h.style,styleConfidence:h.confidence,heldReason:h.heldReason,missing:h.missing};}),
  guardrails:{persisted:true,formalLock:false,eligibleForLearning:false,automaticPromotion:false,savedPredictionModified:false,humanMarksUsed:false,accuracyValidated:false,externalRequests:0}};
 const body=JSON.stringify(snapshot),hash=await sha256(body);
 try{const result=await db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?,?,?,?,?)`).bind(hash,key(t),modelVersion,sourceFingerprint,body,snapshot.savedAt).run();const read=await readEvidenceEvaluation(db,{...t,sha256:hash});if(!read.available||read.snapshotSha256!==hash||JSON.stringify(read.snapshot)!==body)throw Error('検証評価版の保存後読返しが一致しません。');return{...read,saved:Number(result.meta?.changes)===1?1:0};}catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
