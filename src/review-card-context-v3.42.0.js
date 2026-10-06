import {sha256,runnerFingerprint} from './card-evidence.js';
import {reviewDay} from './comparison-review-v3.42.0.js';
export async function reviewCardContext(db,race,source,stamp=Date.now()){
 const raceKey=race.raceKey||race.date+':'+race.venue+':'+race.raceNo;
 const official=Boolean(source.official||source.authoritativeForCard);
 const base={raceKey,official,frameVerified:false,today:reviewDay(stamp),snapshotId:source.snapshotId||null,sourceSha256:null,sourceFetchedAt:null,roster:[],referenceScoreUsesFrame:false,officialMarkRevision:false};
 if(!official)return base;
 const runners=(await db.prepare('SELECT horse_no,frame_no,horse_name,age FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(raceKey).all()).results||[];
 base.roster=runners.map(r=>({horseName:r.horse_name,horseNo:Number(r.horse_no),frameNo:null,age:Number(r.age)}));
 let evidence;try{evidence=await db.prepare('SELECT e.*,r.fetched_at,r.runner_count FROM jra_races r LEFT JOIN lab_card_source_evidence e ON e.race_key=r.race_key WHERE r.race_key=?').bind(raceKey).first();}catch(e){if(!/no such table/i.test(String(e)))throw e;return base;}
 base.sourceFetchedAt=evidence?.fetched_at||null;
 const n=runners.length;
 if(n>0&&n<=18&&Number(evidence?.runner_count)===n&&new Set(runners.map(r=>r.horse_name)).size===n&&runners.every((r,i)=>Number(r.horse_no)===i+1&&Number.isInteger(Number(r.frame_no))&&Number(r.frame_no)>=1&&Number(r.frame_no)<=8)&&evidence?.horse_numbers_observed&&evidence?.frames_observed&&evidence.declared_count===n&&evidence.source_row_count===n&&evidence.parsed_count===n&&evidence.card_fetched_at===evidence.fetched_at&&evidence.runner_sha256===await sha256(runnerFingerprint(runners))){base.frameVerified=true;base.sourceSha256=evidence.source_sha256;base.roster=base.roster.map((r,i)=>({...r,frameNo:Number(runners[i].frame_no)}));}
 return base;
}
