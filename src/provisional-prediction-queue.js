import {storedProvisionalSources} from './confirmed-predraw-history-source.js';
import {provisionalExpectedPrediction,repairStoredProgramConditions} from './provisional-expected-prediction.js';
import {saveProvisionalPrediction,readProvisionalPrediction,provisionalStorageKey,provisionalEvaluationFingerprint} from './provisional-prediction-snapshots.js';
import {prepareReviewedRoster} from './expected-roster-seeds.js';
// One candidate per hour, all JRA venues; no upstream network calls.
export async function scheduledProvisionalPrediction(db,now=Date.now(),deps={}){
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_provisional_queue_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,error TEXT)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_provisional_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)').run();
 await db.prepare("INSERT OR IGNORE INTO lab_provisional_clock_v1 VALUES('queue',0)").run();
 const hour=Math.floor(now/3600000)*3600000;
 const claim=await db.prepare("UPDATE lab_provisional_clock_v1 SET next_at=? WHERE name='queue' AND (next_at<=? OR (next_at>=? AND next_at<?))").bind(hour+3600000,now,hour,hour+60000).run();if(Number(claim.meta?.changes)!==1)return{status:'not-due',externalRequests:0};
 const today=new Date(now+9*3600000).toISOString().slice(0,10),from=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10),to=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const rosterPreparation=await(deps.prepareRoster||prepareReviewedRoster)(db,from,to,now);
 const sources=await(deps.sources||storedProvisionalSources)(db,from,to,now),keys=sources.map(s=>provisionalStorageKey(s));
 const receipts=(await db.prepare('SELECT * FROM lab_provisional_queue_v1 WHERE race_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all()).results||[],byKey=new Map(receipts.map(r=>[r.race_key,r]));
 let saved=[];try{saved=(await db.prepare(`SELECT b.race_key,(SELECT json_extract(p.snapshot_json,'$.roster.snapshotId') FROM lab_provisional_predictions_v1 p WHERE p.race_key=b.race_key OR (p.race_key>=b.race_key||':revision:' AND p.race_key<b.race_key||':revision;') ORDER BY p.saved_at DESC,p.rowid DESC LIMIT 1) roster_snapshot_id FROM lab_provisional_predictions_v1 b WHERE b.race_key IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(keys)).all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 const exists=new Set(saved.map(r=>r.race_key));
 // A newly saved roster is new input even before another profile fetch. Reuse
 // append-only revision and retry handling; never rewrite the original version.
 for(const source of sources){
  const k=provisionalStorageKey(source),previous=byKey.get(k),row=saved.find(r=>r.race_key===k);
  if(previous?.status==='verified'&&row?.roster_snapshot_id&&source.snapshotId&&row.roster_snapshot_id!==source.snapshotId)
   byKey.set(k,{...previous,status:'history-updated',next_at:now});
 }
 // Catch up rows collected before this revision hook was deployed. Reuse the
 // existing daily retry deadline and exact collector receipt key; no HTTP.
 const catchup=sources.filter(s=>s.snapshotId&&exists.has(provisionalStorageKey(s))&&byKey.get(provisionalStorageKey(s))?.status==='verified'&&Number(byKey.get(provisionalStorageKey(s)).next_at)<=now).map(s=>({key:provisionalStorageKey(s),historyKey:'expected:'+s.snapshotId}));
 if(catchup.length){
  let updates=[];
  try{updates=(await db.prepare("SELECT json_extract(e.value,'$.key') race_key,MAX(h.checked_at) checked_at,(SELECT MAX(p.saved_at) FROM lab_provisional_predictions_v1 p WHERE p.race_key=json_extract(e.value,'$.key') OR (p.race_key>=json_extract(e.value,'$.key')||':revision:' AND p.race_key<json_extract(e.value,'$.key')||':revision;')) saved_at FROM json_each(?) e JOIN lab_history_collection_receipts h ON h.race_key=json_extract(e.value,'$.historyKey') WHERE h.status='checked' AND h.rows_found>0 AND h.checked_at<=? GROUP BY json_extract(e.value,'$.key')").bind(JSON.stringify(catchup),now).all()).results||[];}catch(e){if(!/no such table: lab_history_collection_receipts/i.test(String(e)))throw e;}
  for(const update of updates){const previous=byKey.get(update.race_key),evaluatedAt=Number(previous.next_at)-86400000;if(Number(update.checked_at)>Math.max(Date.parse(update.saved_at),evaluatedAt))byKey.set(update.race_key,{...previous,status:'history-updated'});}
 }
 const due=sources.filter(s=>s.date>=from&&s.date<=to).filter(s=>{const k=provisionalStorageKey(s),status=byKey.get(k)?.status;return Number(byKey.get(k)?.next_at||0)<=now&&(!exists.has(k)||status==='pending-readback'||status==='history-updated'||/^revision-readback:[a-f0-9]{64}$/.test(status||''))}).sort((a,b)=>Number(byKey.get(provisionalStorageKey(a))?.next_at||0)-Number(byKey.get(provisionalStorageKey(b))?.next_at||0)||a.date.localeCompare(b.date)||a.raceNo-b.raceNo||a.venue.localeCompare(b.venue));
 // Alternate existing hourly slots: completion of saved inputs on odd JST
 // hours; the original oldest-due queue on even hours. Fresh next_at=0 rows
 // cannot starve revisions, and recurring updates cannot consume every slot.
 // Eligibility/retry deadlines above still apply before either selection.
 const completionTurn=Math.floor((now+9*3600000)/3600000)%2===1;
 const completion=completionTurn?due.filter(s=>{const status=byKey.get(provisionalStorageKey(s))?.status;return exists.has(provisionalStorageKey(s))&&(status==='history-updated'||status==='pending-readback'||/^revision-readback:[a-f0-9]{64}$/.test(status||''));}).sort((a,b)=>a.date.localeCompare(b.date)||Number(!(a.raceNo>=9&&a.raceNo<=11))-Number(!(b.raceNo>=9&&b.raceNo<=11))||Number(byKey.get(provisionalStorageKey(a))?.next_at||0)-Number(byKey.get(provisionalStorageKey(b))?.next_at||0)||a.raceNo-b.raceNo||a.venue.localeCompare(b.venue)):[];
 const source=completion[0]||due[0];if(!source)return{status:'no-due-registered-roster',rosterPreparation,externalRequests:0};const k=provisionalStorageKey(source);
 try{
 let result;
 const pendingRevision=/^revision-readback:([a-f0-9]{64})$/.exec(byKey.get(k)?.status||'');
 if(exists.has(k)&&pendingRevision)result={...await readProvisionalPrediction(db,{...source,revisionSha256:pendingRevision[1]},{exact:true}),saved:0,evaluationChanged:true};
 else if(exists.has(k)&&byKey.get(k)?.status==='history-updated'){
  const previous=await readProvisionalPrediction(db,source);
  const repair=await(deps.repair||repairStoredProgramConditions)(db,source),prediction={...await(deps.build||provisionalExpectedPrediction)(db,source,now,{loaded:true,conditions:repair.conditions}),programRepair:repair};
  if(prediction.scoredRunners===0&&!(prediction.race?.raceType==='debut'&&prediction.runners?.length&&prediction.runners.every(r=>r.score===null&&r.rank===null&&r.mark===null)))throw Error('過去走不足のため暫定順位を生成できません。');
  const revisionSha256=await provisionalEvaluationFingerprint(prediction),previousFingerprint=await provisionalEvaluationFingerprint(previous.snapshot||{});
  if(previous.available&&revisionSha256===previousFingerprint)result={...previous,saved:0,evaluationChanged:false};
  else try{result={...await saveProvisionalPrediction(db,{...source,revisionSha256},async()=>prediction,now),evaluationChanged:true};}catch(e){if(e.saveMayHaveSucceeded)e.pendingRevisionSha256=revisionSha256;throw e;}
 }else if(exists.has(k))result={...await readProvisionalPrediction(db,source,{exact:true}),saved:0};
 else result=await saveProvisionalPrediction(db,source,async()=>{const repair=await(deps.repair||repairStoredProgramConditions)(db,source),prediction=await(deps.build||provisionalExpectedPrediction)(db,source,now,{loaded:true,conditions:repair.conditions});if(prediction.scoredRunners===0&&!(prediction.race?.raceType==='debut'&&prediction.runners?.length&&prediction.runners.every(r=>r.score===null&&r.rank===null&&r.mark===null)))throw Error('過去走不足のため暫定順位を生成できません。');return{...prediction,programRepair:repair};},now);
 if(!result.integrityVerified)throw Error('Saved provisional readback not verified');
 await db.prepare("INSERT INTO lab_provisional_queue_v1 VALUES(?,'verified',?,NULL) ON CONFLICT(race_key) DO UPDATE SET status='verified',next_at=excluded.next_at,error=NULL").bind(k,now+86400000).run();
 return{status:'verified',target:k,basis:source.basis||'expected-roster',sourceSha256:source.sourceSha256||null,saved:result.saved,evaluationChanged:result.evaluationChanged??null,evaluationStatus:result.snapshot?.evaluationStatus||null,rosterPreparation,snapshotSha256:result.snapshotSha256,integrityVerified:true,externalRequests:0};
 }catch(e){if(e.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e)))throw e;
 const status=e.pendingRevisionSha256?`revision-readback:${e.pendingRevisionSha256}`:e.saveMayHaveSucceeded?'pending-readback':exists.has(k)&&byKey.get(k)?.status==='history-updated'?'history-updated':'awaiting-data';await db.prepare('INSERT INTO lab_provisional_queue_v1 VALUES(?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error').bind(k,status,now+2*3600000,String(e.message||e)).run();return{status:e.saveMayHaveSucceeded?'pending-readback':status,target:k,error:String(e.message||e),pendingRevisionSha256:e.pendingRevisionSha256||null,rosterPreparation,saveMayHaveSucceeded:!!e.saveMayHaveSucceeded,externalRequests:0,nextAttemptAt:new Date(now+2*3600000).toISOString()};}
}
