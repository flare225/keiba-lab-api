import {sha256} from './card-evidence.js';
// Initial human marks are name-based and never certify an official numbered card.
export async function registeredInitialMarkAudit(db,t,body,normalized){
 const key=`${t.date}:${t.venue}:${t.raceNo}`;let row;
 try{row=await db.prepare('SELECT snapshot_id,record_json FROM lab_expected_roster_registry WHERE race_key=? ORDER BY stored_at DESC,rowid DESC LIMIT 1').bind(key).first();}catch(e){if(/no such table/i.test(String(e)))return null;throw e;}
 if(!row)return null;if(await sha256(row.record_json)!==row.snapshot_id)throw Error('想定名簿の保存ハッシュが一致しません。');const s=JSON.parse(row.record_json);
 if(s.date!==t.date||s.venue!==t.venue||s.raceNo!==t.raceNo||!Array.isArray(s.runners)||!s.runners.length||s.runners.length>100||new Set(s.runners.map(r=>r.horseName)).size!==s.runners.length)throw Error('想定名簿の対象を確認できません。');
 const snapshot='registered:'+row.snapshot_id;if(body.sourceSnapshotId&&body.sourceSnapshotId!==snapshot)throw Error('画面と保存済み想定名簿が異なります。再読込みしてください。');
 const names=new Set(s.runners.map(r=>r.horseName));const marked=normalized.marks.map(m=>{if(m.horseNo!==null||!names.has(m.horseName))throw Error('初期印の馬名が登録済み想定名簿と一致しません。');return{horseNo:null,horseName:m.horseName,mark:m.mark,note:m.note,laboRank:null,laboScore:null,alignment:{level:'unscored',reviewPriority:'unavailable',reason:'initial human mark; independent LABO prediction stored separately'},evidence:{rosterSnapshotId:snapshot,rosterSourceUrl:s.sourceUrl},warnings:['official-card-not-yet-verified']};});
 return{ok:true,stage:'user-mark-db-crosscheck',race:{raceKey:key,date:t.date,venue:t.venue,raceNo:t.raceNo,raceName:s.raceName},phase:'initial',identityBasis:'registered-expected-roster',sourceSnapshotId:snapshot,inputWarnings:normalized.warnings,scoreMutation:false,audit:{mode:'registered-expected-roster-initial',marked,summary:{unscored:marked.length},unmarkedTopCandidates:[],trackBias:null,guardrails:{humanMarksAreIndependent:true,userMarksNeverMutateModelScore:true,officialNumberedCardStillRequired:true,horseNumbersNeverInferred:true}}};
}
