import {readAutomaticPrediction} from './automatic-pre-race-prediction.js';
import {readEvidenceEvaluation} from './evidence-evaluation-snapshots.js';
import {evidenceShadowModel} from './evidence-shadow-model.js';
import {sha256} from './card-evidence.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
export const FORMAL_COMPARISON_MODEL='course-position-shadow-v1-formal-card-v1';
const table='lab_evidence_evaluations_v1';

// Adapter-only model version. The scoring policy is unchanged and unvalidated.
// Use the immutable official prediction's actual input, never the old registry.
export async function buildFormalComparison(baseline,card,now){
 const s=baseline?.snapshot,r=s?.race,t=targetInput(r||{}),key=`${t.date}:${t.venue}:${t.raceNo}`;
 if(!baseline.ok||!baseline.available||!baseline.integrityVerified||!baseline.snapshotSha256||r.raceKey!==key||s.guardrails?.immutable!==true||s.guardrails.humanMarksUsed!==false||s.guardrails.targetResultUsed!==false)throw Error('Verified independent formal baseline required');
 const start=Date.parse(`${t.date}T${card.startTime}:00+09:00`);
 if(!Number.isFinite(start)||now>=start-300000||!Number.isFinite(Date.parse(s.savedAt))||Date.parse(s.savedAt)>now)throw Error('Pre-race deadline or baseline time invalid');
 if(card.raceKey!==r.storedCardKey||card.date!==t.date||card.venue!==t.venue||Number(card.raceNo)!==t.raceNo||!['芝','ダート','障害','障害芝','障害ダート','芝・ダート'].includes(card.surface)||!Number.isFinite(card.distance)||card.distance<=0)throw Error('Official card identity/conditions mismatch');
 const rows=card.runners;
 if(!rows?.length||rows.length>18||rows.length!==r.runnerCount||rows.length!==s.card?.length||rows.length!==s.runners?.length||new Set(rows.map(x=>x.horse_name)).size!==rows.length||new Set(rows.map(x=>x.horse_no)).size!==rows.length||rows.some(x=>!Number.isInteger(x.horse_no)||x.horse_no<1||x.horse_no>18||!Number.isInteger(x.frame_no)||x.frame_no<1||x.frame_no>8))throw Error('Formal runner pool mismatch');
 for(const x of rows){const b=s.card.find(y=>y.horse_no===x.horse_no),p=s.runners.find(y=>y.horseNo===x.horse_no);if(!b||b.horse_name!==x.horse_name||b.frame_no!==x.frame_no||b.age!==x.age||p?.horseName!==x.horse_name||s.histories?.filter(h=>h.horseName===x.horse_name).length!==1)throw Error('Formal runner identity mismatch');}
 const race={...t,surface:card.surface,distance:card.distance},candidate=evidenceShadowModel({race,runners:s.runners,histories:s.histories});
 const fingerprint=await sha256(JSON.stringify({baselineSha256:baseline.snapshotSha256,card,model:FORMAL_COMPARISON_MODEL}));
 return{phase:'shadow-comparison',race,savedAt:new Date(now).toISOString(),modelVersion:FORMAL_COMPARISON_MODEL,scoringPolicyVersion:candidate.policy.model,sourceFingerprint:fingerprint,rosterBasis:'official-card',card,baseline:{snapshotSha256:baseline.snapshotSha256,savedAt:s.savedAt,model:s.modelVersion},candidate,
 runners:candidate.horses.map(h=>{const b=s.runners.find(x=>x.horseName===h.horseName),c=rows.find(x=>x.horse_name===h.horseName);return{horseName:h.horseName,horseNo:c.horse_no,frameNo:c.frame_no,oldRank:b.rank,oldScore:b.score,oldMark:b.mark,newRank:h.rank,newScore:h.score,newMark:h.rank==null?null:({1:'◎',2:'○',3:'▲',4:'△',5:'☆'}[h.rank]||'－'),primaryUsedRows:h.primaryInput.length,courseUsedRows:h.courseInput.length,contributions:h.contributions,runningStyle:h.style,styleConfidence:h.confidence,heldReason:h.heldReason,missing:h.missing};}),
 guardrails:{persisted:true,formalLock:false,eligibleForLearning:false,automaticPromotion:false,savedPredictionModified:false,humanMarksUsed:false,accuracyValidated:false,externalRequests:0}};
}

async function loadFormal(db,t){
 const baseline=await readAutomaticPrediction(db,t);if(!baseline.available)throw Error('Formal baseline not saved');
 const r=await db.prepare('SELECT r.race_key,r.race_date,r.venue,r.race_no,r.surface,r.distance,p.start_time FROM jra_races r JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no WHERE r.race_date=? AND r.venue=? AND r.race_no=?').bind(t.date,t.venue,t.raceNo).first();
 if(!r)throw Error('Official card not saved');
 const runners=(await db.prepare('SELECT horse_no,horse_name,frame_no,age FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(r.race_key).all()).results||[];
 return{baseline,card:{raceKey:r.race_key,date:r.race_date,venue:r.venue,raceNo:Number(r.race_no),surface:r.surface,distance:Number(r.distance),startTime:r.start_time,runners}};
}
export async function saveFormalComparison(db,input,now=Date.now(),load=loadFormal){
 const t=targetInput(input),{baseline,card}=await load(db,t),snapshot=await buildFormalComparison(baseline,card,now),key=`${t.date}:${t.venue}:${t.raceNo}`;
 if(snapshot.race.date!==t.date||snapshot.race.venue!==t.venue||snapshot.race.raceNo!==t.raceNo)throw Error('Formal comparison target mismatch');
 // Existing append-only comparison table and its unchanged schema/triggers.
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${table}(evaluation_sha256 TEXT PRIMARY KEY,race_key TEXT NOT NULL,model_version TEXT NOT NULL,source_fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,saved_at TEXT NOT NULL,UNIQUE(race_key,model_version,source_fingerprint))`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS evidence_evaluation_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'evaluation snapshot is immutable'); END`).run();
 const old=await db.prepare(`SELECT evaluation_sha256 FROM ${table} WHERE race_key=? AND model_version=? AND source_fingerprint=?`).bind(key,FORMAL_COMPARISON_MODEL,snapshot.sourceFingerprint).first();
 if(old)return{...await readEvidenceEvaluation(db,{...t,sha256:old.evaluation_sha256}),saved:0};
 const body=JSON.stringify(snapshot),hash=await sha256(body);
 try{const result=await db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?,?,?,?,?)`).bind(hash,key,FORMAL_COMPARISON_MODEL,snapshot.sourceFingerprint,body,snapshot.savedAt).run();const read=await readEvidenceEvaluation(db,{...t,sha256:hash});if(!read.available||read.snapshotSha256!==hash||JSON.stringify(read.snapshot)!==body)throw Error('Formal comparison readback mismatch');return{...read,saved:Number(result.meta?.changes)===1?1:0};}catch(e){e.saveMayHaveSucceeded=true;throw e;}
}

// Called only after the existing comparison lane has claimed its hourly slot.
// No second clock/lane, external fetch, registry scan or history scan is added.
export async function scheduledFormalComparison(db,now=Date.now(),deps={}){
 const today=new Date(now+9*3600000).toISOString().slice(0,10),to=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10),model=FORMAL_COMPARISON_MODEL;
 let rows;try{rows=(await db.prepare(`SELECT a.race_key,a.snapshot_sha256 AS baseline_sha,r.runner_count,q.status,
 (SELECT e.evaluation_sha256 FROM lab_evidence_evaluations_v1 e WHERE e.race_key=a.race_key AND e.model_version=? AND json_extract(e.snapshot_json,'$.baseline.snapshotSha256')=a.snapshot_sha256 LIMIT 1) existing_sha
 FROM lab_automatic_predictions_v1 a JOIN jra_races r ON r.race_date=substr(a.race_key,1,10) AND r.venue=json_extract(a.snapshot_json,'$.race.venue') AND r.race_no=json_extract(a.snapshot_json,'$.race.raceNo') JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no
 LEFT JOIN lab_evidence_queue_v1 q ON q.race_key=a.race_key AND q.model_version=?
 WHERE a.race_date BETWEEN ? AND ? AND r.runner_count BETWEEN 1 AND 18 AND COALESCE(q.next_at,0)<=? AND datetime(p.race_date||'T'||p.start_time||':00+09:00')>datetime(?,'unixepoch','+5 minutes')
 AND (q.status='pending-readback' OR NOT EXISTS(SELECT 1 FROM lab_evidence_evaluations_v1 e WHERE e.race_key=a.race_key AND e.model_version=? AND json_extract(e.snapshot_json,'$.baseline.snapshotSha256')=a.snapshot_sha256))
 ORDER BY COALESCE(q.next_at,0),a.race_date,p.start_time,a.race_key LIMIT 1`).bind(model,model,today,to,now,now/1000,model).all()).results||[];}catch(e){if(/no such table/i.test(String(e)))return null;throw e;}
 const row=rows[0];if(!row)return null;
 const [date,venue,raceNo]=row.race_key.split(':'),t=targetInput({date,venue,raceNo});
 const record=async(status,next,error=null)=>db.prepare('INSERT INTO lab_evidence_queue_v1 VALUES(?,?,?,?,?) ON CONFLICT(race_key,model_version) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error').bind(row.race_key,model,status,next,error).run();
 try{
  await record('pending-readback',(Math.floor(now/3600000)+1)*3600000);
  const result=row.existing_sha?{...await(deps.read||readEvidenceEvaluation)(db,{...t,sha256:row.existing_sha}),saved:0}:await(deps.save||saveFormalComparison)(db,t,now);
  const s=result.snapshot;
  if(!result.available||!result.integrityVerified||s?.modelVersion!==model||s.rosterBasis!=='official-card'||s.baseline.snapshotSha256!==row.baseline_sha||s.runners.length!==Number(row.runner_count))throw Error('Formal comparison readback/identity mismatch');
  await record('verified',(Math.floor(now/3600000)+1)*3600000);
  return{status:'verified',target:row.race_key,saved:result.saved||0,model,savedAt:s.savedAt,snapshotSha256:result.snapshotSha256,runnerCount:s.runners.length,scoredRunners:s.runners.filter(r=>r.newRank!==null).length,heldRunners:s.runners.filter(r=>r.newRank===null).length,primaryInputRows:s.runners.reduce((n,r)=>n+r.primaryUsedRows,0),integrityVerified:true,rosterBasis:'official-card',phase:'shadow-comparison',automaticPromotion:false,formalLock:false,externalRequests:0};
 }catch(e){if(e.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e)))throw e;const status=e.saveMayHaveSucceeded||row.existing_sha?'pending-readback':'awaiting-data';await record(status,now+7200000,String(e.message||e).slice(0,2000));return{status,target:row.race_key,model,error:String(e.message||e),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded,nextAttemptAt:new Date(now+7200000).toISOString(),externalRequests:0};}
}
