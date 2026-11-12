import {sha256} from './card-evidence.js';
// Reviewed JRA notice, not a fabricated card or a replay of its source HTML.
// This reconciliation is retrospective only; it never unlocks pre-race writers.
const notices=[{date:'2026-10-25',venue:'京都',raceNo:3,horseNo:5,horseName:'シュプレヒコール',status:'取消',sourceUrl:'https://www.jra.go.jp/news/202610/102503.html',proofKind:'reviewed-public-JRA-notice',sourceHtmlSha256:null}];
export function hasReviewedWithdrawal(target,stamp){return !!target&&Number.isFinite(Date.parse(target.startAt||''))&&Date.parse(target.startAt)<stamp&&notices.some(n=>n.date===target.date&&n.venue===target.venue&&n.raceNo===target.raceNo);}
export function resolveReviewedWithdrawal(inspection,target,stamp){
 if(!inspection.cancelledRows?.length)return inspection;
 // An explicit official start allows same-day retrospective reconciliation.
 const start=Date.parse(target.startAt||'');if(!Number.isFinite(start)||stamp<=start)return inspection;
 const matched=inspection.cancelledRows.map(c=>{const n=notices.find(n=>n.date===target.date&&n.venue===target.venue&&n.raceNo===Number(target.raceNo)&&n.horseName===c.horseName&&c.horseNo===null);if(!n)return null;return{...n,frameNo:c.frameNo};});
 if(matched.some(n=>!n))return inspection;
 const raw=inspection.raw.map(r=>{const n=matched.find(n=>n.horseName===r.name);return n?{...r,horseNo:n.horseNo}:r;}).sort((a,b)=>a.horseNo-b.horseNo),frames=new Map(inspection.frames);
 for(const n of matched){if(!Number.isInteger(n.frameNo)||n.frameNo<1||n.frameNo>8)return inspection;frames.set(n.horseNo,n.frameNo);}
 const complete=raw.length===inspection.declaredCount&&raw.length===inspection.sourceRowCount&&raw.every((r,i)=>r.horseNo===i+1)&&new Set(raw.map(r=>r.name)).size===raw.length&&raw.every(r=>Number.isInteger(frames.get(r.horseNo)));
 return complete?{...inspection,raw,frames,withdrawals:matched,numberSourcesVerified:true,allFramesObserved:true}:inspection;
}
export async function saveWithdrawalEvidence(db,raceKey,withdrawals,cardSha,recordedAt=Date.now()){
 if(!withdrawals?.length)return;
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_card_withdrawals_v1(race_key TEXT NOT NULL,horse_no INTEGER NOT NULL,horse_name TEXT NOT NULL,status TEXT NOT NULL,proof_json TEXT NOT NULL,proof_sha256 TEXT NOT NULL,card_source_sha256 TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(race_key,horse_no))').run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS withdrawal_no_${action.toLowerCase()} BEFORE ${' '+action} ON lab_card_withdrawals_v1 BEGIN SELECT RAISE(ABORT,'withdrawal evidence is immutable'); END`).run();
 for(const w of withdrawals){const body=JSON.stringify(w),hash=await sha256(body);await db.prepare('INSERT OR IGNORE INTO lab_card_withdrawals_v1 VALUES(?,?,?,?,?,?,?,?)').bind(raceKey,w.horseNo,w.horseName,w.status,body,hash,cardSha,new Date(recordedAt).toISOString()).run();const row=await db.prepare('SELECT * FROM lab_card_withdrawals_v1 WHERE race_key=? AND horse_no=?').bind(raceKey,w.horseNo).first();if(!row||row.proof_json!==body||row.proof_sha256!==hash||row.card_source_sha256!==cardSha)throw Error('Withdrawal evidence save/readback mismatch');}
}
export async function readWithdrawalEvidence(db,raceKey){
 let rows;try{rows=(await db.prepare('SELECT * FROM lab_card_withdrawals_v1 WHERE race_key=? ORDER BY horse_no').bind(raceKey).all()).results||[];}catch(e){if(!/no such table/.test(String(e)))throw e;return[];}
 return Promise.all(rows.map(async r=>{if(await sha256(r.proof_json)!==r.proof_sha256)throw Error('Withdrawal evidence hash mismatch');return{...JSON.parse(r.proof_json),proofSha256:r.proof_sha256,cardSourceSha256:r.card_source_sha256,recordedAt:r.recorded_at};}));
}
