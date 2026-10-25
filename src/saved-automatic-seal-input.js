import {AUTOMATIC_MODEL,readAutomaticPrediction} from './automatic-pre-race-prediction.js';
import {featureCapturedBeforeOfficialStart} from './learning-experiment-v3.40.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {sha256,verifyCurrentCardEvidence} from './card-evidence.js';

// Local integration seam for the existing seal store. No writer, endpoint or
// cron imports this function. Eligibility is not a LOCK or an atomic guarantee.
export async function prepareSavedAutomaticSealInput(db,input,now=Date.now()){
 const t=targetInput(input),read=await readAutomaticPrediction(db,t);
 if(!read.available)return{ok:true,eligible:false,sealed:false,status:'awaiting-saved-automatic-prediction'};
 const s=read.snapshot,body=JSON.stringify(s),key=`${t.date}:${t.venue}:${t.raceNo}`;
 if(s.modelVersion!==AUTOMATIC_MODEL||s.race.raceKey!==key||s.guardrails?.immutable!==true||s.guardrails.humanMarksUsed!==false||s.guardrails.targetResultUsed!==false||await sha256(body)!==read.snapshotSha256)throw Error('Saved automatic prediction provenance mismatch');
 if(now<Date.parse(s.savedAt))throw Error('Seal check precedes the original prediction save');
 if(!await featureCapturedBeforeOfficialStart(db,t,now))return{ok:true,eligible:false,sealed:false,status:'deadline-passed-or-unverified',predictionSha256:read.snapshotSha256};
 const current=await db.prepare('SELECT race_key,runner_count,fetched_at FROM jra_races WHERE race_key=? AND race_date=? AND venue=? AND race_no=?').bind(s.race.storedCardKey,t.date,t.venue,t.raceNo).first();
 if(!current)throw Error('Current formal card is unavailable');
 const runners=(await db.prepare('SELECT horse_no,horse_name,age,frame_no FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(current.race_key).all()).results||[];
 if(current.runner_count!==runners.length||runners.length!==s.race.runnerCount||JSON.stringify(runners)!==JSON.stringify(s.card))throw Error('Current formal card differs from the saved prediction');
 const marks={1:'◎',2:'○',3:'▲',4:'△',5:'☆'};
 if(s.runners.length!==runners.length||new Set(s.runners.map(r=>r.horseNo)).size!==runners.length||s.runners.some(r=>!Number.isInteger(r.rank)||r.rank<1||r.rank>runners.length||!Number.isFinite(r.score)||r.score<0||r.score>100||r.mark!==(marks[r.rank]||null)||!runners.some(c=>c.horse_no===r.horseNo&&c.horse_name===r.horseName)))throw Error('Saved whole-field ranks, marks and scores are incomplete');
 const evidence=await db.prepare('SELECT * FROM lab_card_source_evidence WHERE race_key=?').bind(current.race_key).first();
 await verifyCurrentCardEvidence(evidence,current,runners);
 const result=await db.prepare('SELECT EXISTS(SELECT 1 FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL) OR EXISTS(SELECT 1 FROM lab_race_result_details WHERE race_key=?) AS found').bind(current.race_key,current.race_key).first();
 if(result.found)throw Error('Official target results already exist');
 return{ok:true,eligible:true,sealed:false,status:'eligible-saved-prediction',race:t,modelVersion:s.modelVersion,predictionSha256:read.snapshotSha256,predictionSavedAt:s.savedAt,checkedAt:new Date(now).toISOString(),runnerCount:runners.length,snapshotJson:body,cardEvidence:evidence,requiresAtomicRecheck:true,guardrails:{scoreRecomputed:false,predictionWritten:false,lockWritten:false,humanMarksChanged:false}};
}
