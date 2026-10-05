import {runScheduledFast} from './fast-rotation-v3.8.1.js';
export const VERSION='3.8.1';

export async function ensureJobTable(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS lab_collection_runs (
 run_id TEXT PRIMARY KEY,trigger_kind TEXT NOT NULL,scheduled_at TEXT NOT NULL,
 started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,
 attempted INTEGER NOT NULL DEFAULT 0,saved_cards INTEGER NOT NULL DEFAULT 0,
 saved_runners INTEGER NOT NULL DEFAULT 0,missing_cards INTEGER NOT NULL DEFAULT 0,
 failed_cards INTEGER NOT NULL DEFAULT 0,source_errors INTEGER NOT NULL DEFAULT 0,
 progress_json TEXT NOT NULL DEFAULT '{}',error TEXT,version TEXT NOT NULL
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS lab_collection_runs_started ON lab_collection_runs(started_at)').run();
}

export function summarize(result){
 const totals={attempted:0,savedCards:0,savedRunners:0,missingCards:0,failedCards:0,sourceErrors:0};
 for(const day of result.runs||[]){
  totals.attempted+=Number(day.attempted||0);totals.savedCards+=Number(day.storedRaceCards||0);totals.savedRunners+=Number(day.storedRunners||0);
  totals.missingCards+=(day.runs||[]).filter(x=>x.status==='card-not-discovered').length;
  totals.failedCards+=(day.runs||[]).filter(x=>x.status==='failed').length+(day.error?1:0);
  totals.sourceErrors+=(day.discoveryErrors||[]).length;
 }
 const errors=totals.failedCards+totals.sourceErrors;
 const status=totals.savedCards>0?(errors||totals.missingCards?'partial':'success'):errors?'error':totals.missingCards?'cards-not-discovered':'no-work';
 return {...totals,status};
}

export async function executeCollection(event,env,ctx,{trigger='scheduled',runId,run=runScheduledFast,now=()=>new Date()}={}){
 const db=env.DB;await ensureJobTable(db);
 const startedAt=now().toISOString(),scheduledAt=new Date(event.scheduledTime).toISOString();
 const id=runId||(trigger==='scheduled'?`scheduled:${scheduledAt}:${event.cron||'0 * * * *'}`:`manual:${crypto.randomUUID()}`);
 const inserted=await db.prepare(`INSERT INTO lab_collection_runs(run_id,trigger_kind,scheduled_at,started_at,status,version) VALUES(?,?,?,?,'running',?) ON CONFLICT(run_id) DO NOTHING`).bind(id,trigger,scheduledAt,startedAt,VERSION).run();
 if(Number(inserted.meta?.changes??inserted.changes)===0)return{ok:true,idempotent:true,runId:id,status:'already-recorded',version:VERSION};
 try{
  const result=await run(event,env,ctx),summary=summarize(result);
  await db.prepare(`UPDATE lab_collection_runs SET finished_at=?,status=?,attempted=?,saved_cards=?,saved_runners=?,missing_cards=?,failed_cards=?,source_errors=?,progress_json=? WHERE run_id=? AND status='running'`).bind(now().toISOString(),summary.status,summary.attempted,summary.savedCards,summary.savedRunners,summary.missingCards,summary.failedCards,summary.sourceErrors,JSON.stringify(result),id).run();
  return{ok:summary.status==='success'||summary.status==='no-work',runId:id,trigger,version:VERSION,...summary,result};
 }catch(error){
  const message=String(error).slice(0,4000);
  await db.prepare(`UPDATE lab_collection_runs SET finished_at=?,status='error',error=? WHERE run_id=? AND status='running'`).bind(now().toISOString(),message,id).run();
  throw error;
 }
}

export async function schedulerStatus(db,{limit=10,now=new Date()}={}){
 await ensureJobTable(db);
 const rows=(await db.prepare('SELECT * FROM lab_collection_runs ORDER BY started_at DESC,run_id DESC LIMIT ?').bind(limit).all()).results||[];
 const latestScheduled=await db.prepare("SELECT * FROM lab_collection_runs WHERE trigger_kind='scheduled' ORDER BY scheduled_at DESC LIMIT 1").first();
 const nowMs=now.getTime();
 const present=row=>{if(!row)return null;return{...row,progress:JSON.parse(row.progress_json),progress_json:undefined,stalled:row.status==='running'&&nowMs-Date.parse(row.started_at)>30*60*1000};};
 const heartbeat=!latestScheduled?'not-observed':nowMs-Date.parse(latestScheduled.scheduled_at)>90*60*1000?'overdue':latestScheduled.status==='running'?'running':'observed';
 return{ok:true,version:VERSION,checkedAt:now.toISOString(),configuredCron:'0 * * * *',rotation:'five-hour-complete-sweep',cronHeartbeat:heartbeat,latestScheduled:present(latestScheduled),runs:rows.map(present),note:'Manual runs do not prove cron execution. cards-not-discovered does not prove nonpublication.'};
}
