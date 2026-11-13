import {readSavedAutomaticSeal} from './saved-automatic-seal.js';
import {readAutomaticLearningCandidate,scheduledAutomaticCandidates} from './automatic-learning-candidates.js';
import {collectRichResult} from './rich-result-collection-v3.39.0.js';
import {discoverResultSource,resultWindowOpen} from './official-result-sources-v3.39.0.js';

// Only the expired pre-race focus reaches this lane. Never remove focus or
// resume broad queues. Existing writers own source leases, receipts and hashes.
export async function collectFocusedOutcomes(db,target,deps={}){
 const now=deps.now||Date.now,stamp=now(),focusRaceKey=`${target.date}:${target.venue}:${target.raceNo}`;
 const waiting=status=>({ok:true,status,focusRaceKey,externalRequests:0});
 if(!await (deps.window||resultWindowOpen)(db,target.date,target.venue,target.raceNo,stamp))return waiting('focus-awaiting-result-window');
 const lock=await (deps.lock||readSavedAutomaticSeal)(db,target);
 if(!lock.locked||!lock.integrityVerified||!lock.preRaceVerified)return waiting('focus-awaiting-verified-lock');
 const old=await (deps.readCandidate||readAutomaticLearningCandidate)(db,target);
 const paired=r=>{
  if(r.available&&r.record.predictionSha256!==lock.snapshotSha256)throw Error('Focused candidate does not match original LOCK');
  return r;
 };
 if(old.available){paired(old);return{ok:true,status:'focus-outcomes-complete',focusRaceKey,labelSha256:old.labelSha256,predictionSha256:lock.snapshotSha256,saved:0,externalRequests:0};}
 const result=await (deps.results||collectRichResult)(db,target,{now,...(deps.fetcher?{fetcher:deps.fetcher}:{})});
 if(result.status==='source-unresolved'){
  // collectRichResult ensured the existing tables. Select only this card and
  // respect its discovery receipt; no unscoped fallback is permitted.
  const sourceTarget=await db.prepare(`SELECT r.*,e.source_url card_url FROM jra_races r JOIN lab_card_source_evidence e ON e.race_key=r.race_key LEFT JOIN lab_result_source_receipts c ON c.race_key=r.race_key WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND (c.race_key IS NULL OR c.next_check_at<=?) LIMIT 1`).bind(target.date,target.venue,target.raceNo,stamp).first();
  return sourceTarget?{...await (deps.discover||discoverResultSource)(db,{now,target,sourceTarget,...(deps.fetcher?{fetcher:deps.fetcher}:{})}),focusRaceKey}:waiting('focus-result-source-not-due');
 }
 if(!['complete','collected'].includes(result.status))return{...result,focusRaceKey};
 const candidate=paired(await (deps.candidates||scheduledAutomaticCandidates)(db,stamp,target));
 return{...result,focusRaceKey,candidate,status:candidate.available?'focus-outcomes-complete':result.status};
}
