import {assessmentContext,officialHistoryEvidence,targetInput} from './race-history-assessment-v3.31.0.js';
import {postRaceHistoryBatch} from './post-race-history-batch.js';
import {featureCapturedBeforeOfficialStart} from './learning-experiment-v3.40.0.js';
import {sha256} from './card-evidence.js';
import {jstDay} from './history-collection-v3.37.0.js';
const TABLE='lab_automatic_predictions_v1',RECEIPTS='lab_automatic_prediction_receipts_v1';
export const AUTOMATIC_MODEL='existing-safe-core-1.5-recent-three-v1';
async function ensure(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(race_key TEXT PRIMARY KEY,race_date TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,saved_at TEXT NOT NULL)`).run();
 await db.prepare(`CREATE INDEX IF NOT EXISTS automatic_prediction_date ON ${TABLE}(race_date,race_key)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${RECEIPTS}(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_attempt_at INTEGER NOT NULL,detail_json TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS automatic_prediction_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'automatic prediction is immutable'); END`).run();
}
export async function readAutomaticPrediction(db,input){
 const t=targetInput(input);let row;
 try{row=await db.prepare(`SELECT * FROM ${TABLE} WHERE race_key=?`).bind(`${t.date}:${t.venue}:${t.raceNo}`).first()}catch(e){if(/no such table/i.test(String(e)))return{ok:true,available:false};throw e}
 if(!row)return{ok:true,available:false};
 if(await sha256(row.snapshot_json)!==row.snapshot_sha256)throw Error('自動事前予想のハッシュが一致しません。');
 const snapshot=JSON.parse(row.snapshot_json);
 if(snapshot.race.raceKey!==row.race_key||snapshot.savedAt!==row.saved_at||!await featureCapturedBeforeOfficialStart(db,snapshot.race,Date.parse(row.saved_at)))throw Error('自動事前予想の保存証跡が一致しません。');
 return{ok:true,available:true,integrityVerified:true,snapshotSha256:row.snapshot_sha256,snapshot};
}
async function card(db,context){
 const rows=(await db.prepare('SELECT horse_no,horse_name,age,frame_no FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(context.raceKey).all()).results||[];
 if(rows.length!==context.runners.length||new Set(rows.map(r=>Number(r.horse_no))).size!==rows.length||rows.some(r=>!Number.isInteger(Number(r.horse_no))||r.horse_no<1||r.horse_no>18||!Number.isInteger(Number(r.frame_no))||r.frame_no<1||r.frame_no>8))throw Error('正式な枠順・馬番が未保存です。');
 return rows;
}
export async function captureAutomaticPrediction(db,input,now=Date.now()){
 const started=Date.now(),t=targetInput(input),key=`${t.date}:${t.venue}:${t.raceNo}`;
 const old=await readAutomaticPrediction(db,t);if(old.available)return{...old,saved:0,idempotent:true,externalRequests:0};
 if(!await featureCapturedBeforeOfficialStart(db,t,now))throw Error('公式発走5分前以降、または発走時刻未確認のため保存しません。');
 const context=await assessmentContext(db,t);if(!context.official)throw Error('正式出馬表が未保存です。');
 const runners=await card(db,context);
 const outcome=await db.prepare('SELECT 1 AS found FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL LIMIT 1').bind(context.raceKey).first();
 const detail=await db.prepare('SELECT 1 AS found FROM lab_race_result_details WHERE race_key=? LIMIT 1').bind(context.raceKey).first();
 if(outcome||detail)throw Error('対象結果が保存済みのため事前予想を作成しません。');
 const {histories,all}=await officialHistoryEvidence(db,context,null,await postRaceHistoryBatch(db,context));
 const missing=all.filter(r=>!r.assessment.available||!Number.isFinite(r.assessment.evidenceScore)).map(r=>r.horseName);
 if(missing.length)return{ok:true,status:'awaiting-prior-history',missingHistoryHorses:missing,saved:0,externalRequests:0};
 const savedAt=new Date(now+Date.now()-started).toISOString();
 if(!await featureCapturedBeforeOfficialStart(db,t,Date.parse(savedAt)))throw Error('評価中に事前保存締切を過ぎました。');
 if(JSON.stringify(await card(db,context))!==JSON.stringify(runners))throw Error('評価中に出馬表が更新されました。次回再評価します。');
 const marks={1:'◎',2:'○',3:'▲',4:'△',5:'☆'};
 const snapshot={modelVersion:AUTOMATIC_MODEL,race:{...t,raceKey:key,storedCardKey:context.raceKey,runnerCount:runners.length},savedAt,trackAssumption:null,card:runners,
 runners:all.map(r=>({horseNo:r.horseNo,horseName:r.horseName,rank:r.referenceRank,tiedCount:r.tiedCount,mark:marks[r.referenceRank]||null,score:r.assessment.evidenceScore,assessment:r.assessment})),histories,
 guardrails:{humanMarksUsed:false,targetResultUsed:false,immutable:true,automaticPromotion:false,learningCandidateRegistered:false,eligibleForFrozenValidation:false}};
 const body=JSON.stringify(snapshot),hash=await sha256(body);await ensure(db);
 try{
 const result=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM lab_race_result_details WHERE race_key=?) AND (SELECT COUNT(*) FROM jra_runners WHERE race_key=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM jra_runners r WHERE r.race_key=? AND r.horse_no=json_extract(e.value,'$.horse_no') AND r.horse_name=json_extract(e.value,'$.horse_name') AND r.frame_no=json_extract(e.value,'$.frame_no') AND r.age=json_extract(e.value,'$.age')))`).bind(key,t.date,body,hash,savedAt,context.raceKey,context.raceKey,context.raceKey,runners.length,JSON.stringify(runners),context.raceKey).run();
 const read=await readAutomaticPrediction(db,t);
 if(!read.available||(!Number(result.meta?.changes)&&read.snapshotSha256!==hash)){
  if(read.available)return{...read,saved:0,idempotent:true,externalRequests:0};
  throw Error('自動予想のDB読み返しを確認できません。');
 }
 if(read.snapshotSha256!==hash||JSON.stringify(read.snapshot)!==body)throw Error('自動予想のDB読み返しが一致しません。');
 return{...read,saved:Number(result.meta?.changes)||0,externalRequests:0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
export async function scheduledAutomaticPrediction(db,now=Date.now()){
 await ensure(db);const today=jstDay(now),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 // One indexed, bounded queue, independent of user marks and frozen experiments.
 const rows=(await db.prepare(`SELECT r.race_date AS date,r.venue,r.race_no AS raceNo FROM jra_races r JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no LEFT JOIN ${TABLE} a ON a.race_key=r.race_date||':'||r.venue||':'||r.race_no LEFT JOIN ${RECEIPTS} c ON c.race_key=r.race_date||':'||r.venue||':'||r.race_no WHERE r.race_date BETWEEN ? AND ? AND r.runner_count>0 AND a.race_key IS NULL AND COALESCE(c.next_attempt_at,0)<=? AND datetime(p.race_date||'T'||p.start_time||':00+09:00')>datetime(?,'unixepoch','+5 minutes') ORDER BY COALESCE(c.next_attempt_at,0),r.race_date,p.start_time,r.venue,r.race_no LIMIT 1`).bind(today,until,now,now/1000).all()).results||[];
 if(!rows.length)return{ok:true,status:'no-due-race',saved:0,externalRequests:0};
 const t=rows[0],key=`${t.date}:${t.venue}:${t.raceNo}`;let result;
 try{result=await captureAutomaticPrediction(db,t,now)}catch(e){if(e.saveMayHaveSucceeded)throw e;result={ok:false,status:'deferred',error:String(e.message||e),saved:0,externalRequests:0}}
 await db.prepare(`INSERT INTO ${RECEIPTS} VALUES(?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_attempt_at=excluded.next_attempt_at,detail_json=excluded.detail_json`).bind(key,result.available?'saved':result.status,now+3600000,JSON.stringify(result.available?{snapshotSha256:result.snapshotSha256}:{...result})).run();
 return{...result,target:t};
}
