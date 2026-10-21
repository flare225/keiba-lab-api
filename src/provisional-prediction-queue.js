import {storedExpectedSources} from './expected-roster-registry.js';
import {provisionalExpectedPrediction,repairStoredProgramConditions} from './provisional-expected-prediction.js';
import {saveProvisionalPrediction,readProvisionalPrediction} from './provisional-prediction-snapshots.js';
// One candidate per hour, all JRA venues; no upstream network calls.
export async function scheduledProvisionalPrediction(db,now=Date.now(),deps={}){
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_provisional_queue_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,error TEXT)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_provisional_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)').run();
 await db.prepare("INSERT OR IGNORE INTO lab_provisional_clock_v1 VALUES('queue',0)").run();
 const claim=await db.prepare("UPDATE lab_provisional_clock_v1 SET next_at=? WHERE name='queue' AND next_at<=?").bind(now+3600000,now).run();if(Number(claim.meta?.changes)!==1)return{status:'not-due',externalRequests:0};
 const today=new Date(now+9*3600000).toISOString().slice(0,10),from=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10),to=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const sources=await(deps.sources||storedExpectedSources)(db,from,to),keys=sources.map(s=>s.raceKey||`${s.date}:${s.venue}:${s.raceNo}`);
 const receipts=(await db.prepare('SELECT * FROM lab_provisional_queue_v1 WHERE race_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all()).results||[],byKey=new Map(receipts.map(r=>[r.race_key,r]));
 let saved=[];try{saved=(await db.prepare('SELECT race_key FROM lab_provisional_predictions_v1 WHERE race_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 const exists=new Set(saved.map(r=>r.race_key));
 const due=sources.filter(s=>s.date>=from&&s.date<=to).filter(s=>{const k=s.raceKey||`${s.date}:${s.venue}:${s.raceNo}`,r=byKey.get(k);return Number(r?.next_at||0)<=now&&(!exists.has(k)||r?.status==='pending-readback')}).sort((a,b)=>Number(byKey.get(a.raceKey)?.next_at||0)-Number(byKey.get(b.raceKey)?.next_at||0));
 const source=due[0];if(!source)return{status:'no-due-registered-roster',externalRequests:0};const k=source.raceKey||`${source.date}:${source.venue}:${source.raceNo}`;
 try{
 const result=exists.has(k)?{...await readProvisionalPrediction(db,source),saved:0}:await saveProvisionalPrediction(db,source,async()=>{const repair=await(deps.repair||repairStoredProgramConditions)(db,source);return{...await(deps.build||provisionalExpectedPrediction)(db,source,now),programRepair:repair};},now);
 if(!result.integrityVerified)throw Error('Saved provisional readback not verified');
 await db.prepare("INSERT INTO lab_provisional_queue_v1 VALUES(?,'verified',?,NULL) ON CONFLICT(race_key) DO UPDATE SET status='verified',next_at=excluded.next_at,error=NULL").bind(k,now+86400000).run();
 return{status:'verified',target:k,saved:result.saved,snapshotSha256:result.snapshotSha256,integrityVerified:true,externalRequests:0};
 }catch(e){if(e.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e)))throw e;
 const status=e.saveMayHaveSucceeded?'pending-readback':'awaiting-data';await db.prepare('INSERT INTO lab_provisional_queue_v1 VALUES(?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error').bind(k,status,now+2*3600000,String(e.message||e)).run();return{status,target:k,error:String(e.message||e),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded,externalRequests:0,nextAttemptAt:new Date(now+2*3600000).toISOString()};}
}
