import {sha256,runnerFingerprint} from './card-evidence.js';
const POLICY='locked-reference-result-v1';
const terminals=new Set(['scratched','excluded','did-not-finish','disqualified']);
export async function collectLockedMarkResults(db,limit=10){
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_locked_mark_results(evidence_id TEXT PRIMARY KEY,race_key TEXT NOT NULL,phase TEXT NOT NULL,revision_id TEXT NOT NULL,lock_sha256 TEXT NOT NULL,result_sha256 TEXT NOT NULL,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS locked_mark_results_no_${action.toLowerCase()} BEFORE ${action} ON lab_locked_mark_results BEGIN SELECT RAISE(ABORT,'locked result evidence is immutable'); END`).run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_locked_mark_result_checks(lock_sha256 TEXT PRIMARY KEY,checked_at TEXT NOT NULL)').run();
 let locks;try{locks=(await db.prepare("SELECT * FROM lab_user_mark_locks ORDER BY COALESCE((SELECT checked_at FROM lab_locked_mark_result_checks e WHERE e.lock_sha256=lab_user_mark_locks.snapshot_sha256),'') ASC,locked_at ASC LIMIT ?").bind(limit).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return {ok:true,checked:0,saved:0,waiting:[]};throw e}
 const report={ok:true,checked:locks.length,saved:0,waiting:[]};
 for(const lock of locks){try{
  const snapshot=JSON.parse(lock.snapshot_json);
  const revision=await db.prepare('SELECT * FROM lab_user_mark_revisions WHERE revision_id=?').bind(lock.revision_id).first();
  if(await sha256(lock.snapshot_json)!==lock.snapshot_sha256||snapshot.raceKey!==lock.race_key||snapshot.phase!==lock.phase||snapshot.revisionId!==lock.revision_id||snapshot.lockedAt!==lock.locked_at||snapshot.deadline!==lock.deadline||!['final','post_draw'].includes(lock.phase)||!(Date.parse(lock.locked_at)<Date.parse(lock.deadline))||!revision||revision.race_key!==lock.race_key||revision.phase!==lock.phase||!(Date.parse(revision.created_at)<=Date.parse(lock.locked_at))||await sha256(revision.audit_json)!==revision.audit_sha256||snapshot.auditSha256!==revision.audit_sha256||await sha256(runnerFingerprint(snapshot.runners))!==snapshot.runnerSha256)throw Error('lock-integrity-unverified');
  const audit=JSON.parse(revision.audit_json),assessment=audit.audit?.referenceAssessment;
  if(audit.race?.raceKey!==lock.race_key||!assessment?.guardrails?.allOfficialRunnersIncluded||assessment.guardrails.targetResultUsed!==false||assessment.guardrails.humanMarksUsedInScore!==false||!Array.isArray(assessment.allRunners)||assessment.allRunners.length!==snapshot.runners.length||assessment.runnerPool!==snapshot.runners.length)throw Error('saved-assessment-unavailable');
  const entries=(await db.prepare('SELECT horse_no,horse_name,mark,note,ordinal FROM lab_user_mark_entries WHERE revision_id=? ORDER BY ordinal').bind(lock.revision_id).all()).results||[];
  if(JSON.stringify(entries)!==JSON.stringify(snapshot.entries))throw Error('saved-entries-unverified');
  const results=(await db.prepare('SELECT horse_no,horse_name,finish_position,finish_status,source_url,source_sha256 FROM lab_race_result_details WHERE race_key=? ORDER BY horse_no').bind(lock.race_key).all()).results||[];
  if(results.length!==snapshot.runners.length||new Set(results.map(r=>r.source_sha256)).size!==1||new Set(results.map(r=>r.source_url)).size!==1||new Set(results.map(r=>r.horse_no)).size!==results.length||new Set(assessment.allRunners.map(r=>r.horseNo)).size!==results.length)throw Error('awaiting-complete-results');
  const rows=snapshot.runners.map(r=>{
   const result=results.find(x=>x.horse_no===r.horse_no&&x.horse_name===r.horse_name),reference=assessment.allRunners.find(x=>x.horseNo===r.horse_no&&x.horseName===r.horse_name);
   if(!result||!reference||!/^https:\/\/www\.jra\.go\.jp\//.test(result.source_url||'')||!/^[a-f0-9]{64}$/.test(result.source_sha256||'')||!(result.finish_status==='finished'&&Number.isInteger(result.finish_position)&&result.finish_position>0&&result.finish_position<=results.length||terminals.has(result.finish_status)&&result.finish_position===null))throw Error('result-identity-or-source-unverified');
   return {horseNo:r.horse_no,horseName:r.horse_name,userMark:entries.find(e=>e.horse_no===r.horse_no&&e.horse_name===r.horse_name)?.mark||null,referenceMark:reference.mark,referenceRank:reference.referenceRank,referenceScore:reference.evidenceScore,finishPosition:result.finish_position,finishStatus:result.finish_status,rankGap:result.finish_status==='finished'&&Number.isInteger(reference.referenceRank)?result.finish_position-reference.referenceRank:null};
  });
  const resultHash=await sha256(JSON.stringify(results)),id=await sha256(POLICY+lock.snapshot_sha256+resultHash);
  const evidence=JSON.stringify({policy:POLICY,raceKey:lock.race_key,phase:lock.phase,revisionId:lock.revision_id,lockSha256:lock.snapshot_sha256,auditSha256:revision.audit_sha256,resultSha256:resultHash,modelVersion:assessment.modelVersion,rows,guardrails:{savedScoresOnly:true,retrospectivePredictionCreated:false,automaticPromotion:false,validatedAccuracyClaimed:false}});
  const inserted=await db.prepare('INSERT OR IGNORE INTO lab_locked_mark_results VALUES(?,?,?,?,?,?,?,?,?)').bind(id,lock.race_key,lock.phase,lock.revision_id,lock.snapshot_sha256,resultHash,evidence,await sha256(evidence),new Date().toISOString()).run();
  report.saved+=Number(inserted.meta?.changes)||0;
 }catch(e){report.waiting.push({raceKey:lock.race_key,phase:lock.phase,reason:/no such table/.test(String(e))?'results-storage-unavailable':String(e.message||e)});}finally{await db.prepare('INSERT INTO lab_locked_mark_result_checks VALUES(?,?) ON CONFLICT(lock_sha256) DO UPDATE SET checked_at=excluded.checked_at').bind(lock.snapshot_sha256,new Date().toISOString()).run();}}
 return report;
}
export async function readLockedMarkResults(db,raceKey,phase){
 let rows;try{rows=(await db.prepare('SELECT evidence_json,evidence_sha256,created_at FROM lab_locked_mark_results WHERE race_key=? AND phase=? ORDER BY created_at DESC,rowid DESC LIMIT 10').bind(raceKey,phase).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return [];throw e}
 return Promise.all(rows.map(async r=>{if(await sha256(r.evidence_json)!==r.evidence_sha256)throw Error('stored-evidence-integrity-unverified');return {...JSON.parse(r.evidence_json),evidenceSha256:r.evidence_sha256,createdAt:r.created_at}}));
}
