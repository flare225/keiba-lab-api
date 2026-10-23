import {saveEvidenceEvaluation,readEvidenceEvaluation} from './evidence-evaluation-snapshots.js';
import {SHADOW_POLICY} from './evidence-shadow-model.js';
import {scheduledFormalComparison} from './formal-evidence-evaluation.js';
// A separate comparison lane: no official prediction, human marks or LOCK writes.
export async function scheduledEvidenceEvaluation(db,now=Date.now(),deps={}){
 const model=SHADOW_POLICY.model;
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_evidence_queue_v1(race_key TEXT NOT NULL,model_version TEXT NOT NULL,status TEXT NOT NULL,next_at INTEGER NOT NULL,error TEXT,PRIMARY KEY(race_key,model_version))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_evidence_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)').run();
 await db.prepare("INSERT OR IGNORE INTO lab_evidence_clock_v1 VALUES('comparison',0)").run();
 const nextHour=(Math.floor(now/3600000)+1)*3600000;
 const claim=await db.prepare("UPDATE lab_evidence_clock_v1 SET next_at=? WHERE name='comparison' AND next_at<=?").bind(nextHour,now).run();
 if(Number(claim.meta?.changes)!==1)return{status:'not-due',externalRequests:0};
 const formal=await(deps.formal||scheduledFormalComparison)(db,now);if(formal)return formal;
 const today=new Date(now+9*3600000).toISOString().slice(0,10);
 // Canonical race keys start YYYY-MM-DD:. Keep tomorrow through day seven,
 // using the existing race_key indexes instead of scanning every historical key.
 const fromKey=new Date(Date.parse(today)+86400000).toISOString().slice(0,10)+':',untilKey=new Date(Date.parse(today)+8*86400000).toISOString().slice(0,10)+':';
 let completed=[];try{completed=(await db.prepare('SELECT race_key FROM lab_evidence_evaluations_v1 WHERE model_version=? AND race_key>=? AND race_key<?').bind(model,fromKey,untilKey).all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 const receipts=(await db.prepare('SELECT * FROM lab_evidence_queue_v1 WHERE model_version=? AND race_key>=? AND race_key<?').bind(model,fromKey,untilKey).all()).results||[];
 let candidates=[];try{candidates=(await db.prepare("SELECT race_key,(SELECT COUNT(*) FROM json_each(snapshot_json,'$.runners') r WHERE json_extract(r.value,'$.rank') IS NULL) held FROM lab_provisional_predictions_v1 WHERE race_key>=? AND race_key<? ORDER BY held DESC,race_key LIMIT 120").bind(fromKey,untilKey).all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 const exists=new Set(completed.map(r=>r.race_key)),byKey=new Map(receipts.map(r=>[r.race_key,r]));
 const due=candidates.filter(r=>{const q=byKey.get(r.race_key);return (!exists.has(r.race_key)||q?.status==='pending-readback')&&Number(q?.next_at||0)<=now;}).sort((a,b)=>Number(byKey.get(b.race_key)?.status==='pending-readback')-Number(byKey.get(a.race_key)?.status==='pending-readback')||b.held-a.held||a.race_key.localeCompare(b.race_key));
 const source=due[0];if(!source)return{status:'no-due-comparison',externalRequests:0};
 const k=source.race_key,[date,venue,raceNo]=k.split(':'),target={date,venue,raceNo:Number(raceNo)};
 const record=async(status,next,error=null)=>db.prepare('INSERT INTO lab_evidence_queue_v1 VALUES(?,?,?,?,?) ON CONFLICT(race_key,model_version) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error').bind(k,model,status,next,error).run();
 try{
  // The receipt is durable before INSERT. A lost response first reads the stored row.
  await record('pending-readback',nextHour);
  let result=exists.has(k)?await(deps.read||readEvidenceEvaluation)(db,target):null;
  if(!result?.available)result=await(deps.save||saveEvidenceEvaluation)(db,target,now);
  if(!result.integrityVerified||result.snapshot?.modelVersion!==model)throw Error('Comparison readback/model not verified');
  await record('verified',nextHour);
  const s=result.snapshot;
  return{status:'verified',target:k,saved:result.saved||0,model,savedAt:s.savedAt,snapshotSha256:result.snapshotSha256,runnerCount:s.runners.length,scoredRunners:s.runners.filter(r=>r.newRank!==null).length,heldRunners:s.runners.filter(r=>r.newRank===null).length,primaryInputRows:s.runners.reduce((n,r)=>n+r.primaryUsedRows,0),integrityVerified:true,phase:'shadow-comparison',automaticPromotion:false,formalLock:false,externalRequests:0};
 }catch(e){
  if(e.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e)))throw e;
  const pending=exists.has(k)||byKey.get(k)?.status==='pending-readback'||e.saveMayHaveSucceeded;
  const status=pending?'pending-readback':'awaiting-data',next=now+2*3600000;
  await record(status,next,String(e.message||e).slice(0,2000));
  return{status,target:k,model,error:String(e.message||e),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded,nextAttemptAt:new Date(next).toISOString(),externalRequests:0};
 }
}
