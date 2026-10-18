import {sha256} from './card-evidence.js';

export async function commitVerifiedMarks(db,statements,expected){
 if(typeof db.batch!=='function')throw Error('atomic mark storage is unavailable');
 if(await sha256(expected.auditJson)!==expected.auditSha256)throw Error('mark audit hash mismatch before insert');
 await db.batch(statements);
 // A failed read after a successful batch must not trigger another write.
 try{
  const revision=await db.prepare('SELECT race_key,phase,revision_no,mark_payload_sha256,audit_sha256,audit_json FROM lab_user_mark_revisions WHERE revision_id=?').bind(expected.revisionId).first();
  if(!revision||revision.race_key!==expected.raceKey||revision.phase!==expected.phase||Number(revision.revision_no)!==expected.revisionNo||revision.mark_payload_sha256!==expected.markPayloadSha256||revision.audit_sha256!==expected.auditSha256||revision.audit_json!==expected.auditJson||await sha256(revision.audit_json)!==revision.audit_sha256)return{verified:false,reason:'stored-revision-mismatch'};
  const entries=(await db.prepare('SELECT race_key,phase,horse_no,horse_name,mark,note,ordinal FROM lab_user_mark_entries WHERE revision_id=? ORDER BY ordinal').bind(expected.revisionId).all()).results||[];
  if(entries.length!==expected.marks.length||entries.some((row,i)=>{
   const mark=expected.marks[i];
   return row.race_key!==expected.raceKey||row.phase!==expected.phase||(row.horse_no??null)!==mark.horseNo||row.horse_name!==mark.horseName||row.mark!==mark.mark||(row.note??null)!==mark.note||Number(row.ordinal)!==mark.ordinal;
  }))return{verified:false,reason:'stored-entries-mismatch'};
  return{verified:true,revisionId:expected.revisionId,markedEntries:entries.length,auditSha256:revision.audit_sha256};
 }catch{return{verified:false,reason:'readback-unavailable'}}
}
