import {jstDay} from './history-collection-v3.37.0.js';
import {isJraSourceBlocked} from './jra-page-request.js';
// One calendar page per hourly delivery, under the same lease as profiles/cards.
export async function boundedProgramSweep(event,env,ctx,{stage,now=Date.now,today}={}){
 const db=env.DB,stamp=now(),date=today?today():jstDay(stamp);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_history_collection_budget(name TEXT PRIMARY KEY,locked_until INTEGER NOT NULL,next_batch_at INTEGER NOT NULL,lock_token TEXT)').run();
 await db.prepare("INSERT OR IGNORE INTO lab_history_collection_budget(name,locked_until,next_batch_at) VALUES('jra-history',0,0)").run();
 const gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first();
 if(Math.max(Number(gate?.next_batch_at)||0,Number(gate?.locked_until)||0)>stamp)return{ok:true,status:'cooldown',externalRequests:0,nextBatchAt:new Date(Math.max(Number(gate.next_batch_at)||0,Number(gate.locked_until)||0)).toISOString(),runs:[]};
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_program_sweep_receipts(race_date TEXT PRIMARY KEY,checked_at INTEGER NOT NULL,status TEXT NOT NULL,http_status INTEGER)').run();
 const until=new Date(Date.parse(date+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const receipts=(await db.prepare('SELECT race_date,checked_at FROM lab_program_sweep_receipts WHERE race_date BETWEEN ? AND ?').bind(date,until).all()).results||[];
 const days=Array.from({length:8},(_,i)=>new Date(Date.parse(date+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
 const target=days.map(day=>({day,checked:Number(receipts.find(r=>r.race_date===day)?.checked_at||0)})).filter(r=>!r.checked||stamp-r.checked>=12*3600000).sort((a,b)=>a.checked-b.checked||a.day.localeCompare(b.day))[0];
 if(!target)return{ok:true,status:'programs-not-due',externalRequests:0,runs:[]};
 const token=crypto.randomUUID();const claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes??claim.changes)!==1)return{ok:true,status:'cooldown',externalRequests:0,runs:[]};
 let pause=60000,httpStatus=null,status='failed',error=null,data=null;
 try{
  const response=await stage(new Request('https://keiba-lab.internal/v1/lab/program-stage?date='+target.day),env,ctx);
  data=await response.json();httpStatus=Number(data.httpStatus||response.status);
  if(isJraSourceBlocked(httpStatus))pause=3600000;
  status=response.ok&&data.ok?'program-saved':'failed';error=data.error||null;
 }catch(e){error=String(e?.message||e);pause=3600000;}
 finally{
  await db.prepare('INSERT INTO lab_program_sweep_receipts VALUES(?,?,?,?) ON CONFLICT(race_date) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,http_status=excluded.http_status').bind(target.day,stamp,status,httpStatus).run();
  await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+pause,token).run();
 }
 return{ok:status==='program-saved',status,externalRequests:1,date:target.day,httpStatus,error,nextBatchAt:new Date(now()+pause).toISOString(),runs:[{date:target.day,attempted:1,storedRaceCards:0,storedRunners:0,runs:[],...(error?{error}:{})}],programRaces:Number(data?.raceCount||0)};
}
