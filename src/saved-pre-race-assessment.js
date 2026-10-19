import {targetInput} from './race-history-assessment-v3.31.0.js';
import {sha256,runnerFingerprint} from './card-evidence.js';
const TABLE='lab_saved_reference_features_v1';
export async function verifySavedPreRaceAssessment(row,entries,key,phase){
 if(!row)return null;
 const s=JSON.parse(row.snapshot_json),audit=JSON.parse(row.audit_json),a=audit.audit?.referenceAssessment;
 if(await sha256(row.snapshot_json)!==row.snapshot_sha256||await sha256(row.audit_json)!==row.audit_sha256||s.auditSha256!==row.audit_sha256||s.revisionId!==row.revision_id||s.raceKey!==key||s.phase!==phase||s.lockedAt!==row.locked_at||s.deadline!==row.deadline||row.race_key!==key||row.phase!==phase||audit.race?.raceKey!==key||audit.phase!==phase)throw Error('事前記録の改変検証・識別に失敗しました。');
 const saved=Date.parse(row.created_at),locked=Date.parse(row.locked_at),deadline=Date.parse(row.deadline);
 if(!Number.isFinite(saved)||!Number.isFinite(locked)||!Number.isFinite(deadline)||saved>locked||locked>=deadline||row.deadline.slice(0,10)!==key.slice(0,10))throw Error('事前保存・LOCKの時刻条件を確認できません。');
 if(!Array.isArray(s.runners)||!s.runners.length||await sha256(runnerFingerprint(s.runners))!==s.runnerSha256||JSON.stringify(entries)!==JSON.stringify(s.entries))throw Error('固定した馬名・馬番・印の対応を確認できません。');
 const runners=a?.allRunners;
 if(!a?.guardrails?.allOfficialRunnersIncluded||a.guardrails.targetResultUsed!==false||a.guardrails.humanMarksUsedInScore!==false||!Array.isArray(runners)||runners.length!==s.runners.length||a.runnerPool!==s.runners.length||new Set(runners.map(r=>r.horseNo)).size!==runners.length||runners.some(r=>!s.runners.some(x=>x.horse_no===r.horseNo&&x.horse_name===r.horseName)))throw Error('固定版に全馬の独立した事前参考評価がありません。');
 const missing=runners.filter(r=>r.available!==true||!Number.isFinite(r.evidenceScore)||!Number.isInteger(r.referenceRank)||r.referenceRank<1).map(r=>r.horseName);
 return{phase:'preserved-pre-race-reference',race:{raceKey:key,date:key.slice(0,10),runnerCount:runners.length},source:{kind:'verified-existing-locked-audit',revisionId:row.revision_id,auditSha256:row.audit_sha256,lockSha256:row.snapshot_sha256,originalSavedAt:row.created_at,originalLockedAt:row.locked_at,deadline:row.deadline},referenceAssessment:a,userMarks:entries,missingHorses:missing,complete:missing.length===0,guardrails:{originalPreRaceRecord:true,scoresRecomputed:false,postRaceReconstruction:false,userMarksModified:false,lockModified:false,eligibleForSeparateTraining:missing.length===0,frozenExperimentModified:false,automaticPromotion:false}};
}
export async function readSavedPreRaceAssessment(db,input){
 const t=targetInput(input),phase=input.phase||'final';if(!['final','post_draw'].includes(phase))throw Error('最終または枠順後の固定版を指定してください。');
 const key=`${t.date}:${t.venue}:${t.raceNo}`;
 const row=await db.prepare('SELECT l.*,v.audit_json,v.audit_sha256,v.created_at FROM lab_user_mark_locks l JOIN lab_user_mark_revisions v ON v.revision_id=l.revision_id AND v.race_key=l.race_key AND v.phase=l.phase WHERE l.race_key=? AND l.phase=?').bind(key,phase).first();
 if(!row)return{ok:true,available:false,status:'no-pre-race-lock',raceKey:key};
 const entries=(await db.prepare('SELECT horse_no,horse_name,mark,note,ordinal FROM lab_user_mark_entries WHERE revision_id=? ORDER BY ordinal').bind(row.revision_id).all()).results||[];
 const record=await verifySavedPreRaceAssessment(row,entries,key,phase);
 let preservedFeature=null;try{
  const sha=await sha256(JSON.stringify(record)),stored=await db.prepare(`SELECT feature_sha256,features_json,imported_at FROM ${TABLE} WHERE feature_sha256=?`).bind(sha).first();
  if(stored){if(await sha256(stored.features_json)!==sha||stored.features_json!==JSON.stringify(record))throw Error('保存した学習用事前記録が一致しません。');preservedFeature={featureSha256:sha,importedAt:stored.imported_at,integrityVerified:true};}
 }catch(e){if(!/no such table/.test(String(e)))throw e;}
 return{ok:true,available:true,status:record.complete?'verified-complete-pre-race-reference':'verified-partial-pre-race-reference',record,preservedFeature};
}
export async function preserveSavedPreRaceAssessment(db,input,now=Date.now()){
 const verified=await readSavedPreRaceAssessment(db,input);if(!verified.available)return verified;
 const body=JSON.stringify(verified.record),hash=await sha256(body),s=verified.record.source;
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(feature_sha256 TEXT PRIMARY KEY,race_key TEXT NOT NULL,phase TEXT NOT NULL,revision_id TEXT NOT NULL,audit_sha256 TEXT NOT NULL,lock_sha256 TEXT NOT NULL,features_json TEXT NOT NULL,imported_at TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS saved_reference_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'saved pre-race reference is immutable'); END`).run();
 try{
 const inserted=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?,?,?,?,?,?)`).bind(hash,verified.record.race.raceKey,input.phase||'final',s.revisionId,s.auditSha256,s.lockSha256,body,new Date(now).toISOString()).run();
 const saved=await db.prepare(`SELECT features_json,imported_at FROM ${TABLE} WHERE feature_sha256=?`).bind(hash).first();
 if(!saved||saved.features_json!==body||await sha256(saved.features_json)!==hash)throw Error('事前参考評価の学習用保存を読み返せません。');
 return{...verified,status:verified.record.complete?'pre-race-reference-preserved-awaiting-results':'partial-pre-race-reference-preserved',featureSha256:hash,importedAt:saved.imported_at,idempotent:Number(inserted.meta?.changes)!==1,trainingCreditGranted:false,frozenExperimentModified:false};
 }catch(error){error.saveMayHaveSucceeded=true;throw error;}
}
