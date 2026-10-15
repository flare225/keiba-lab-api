// This is a Worker-scheduled-job budget, not Cloudflare account quota telemetry.
export const SCHEDULED_READ_BUDGET=Object.freeze({scope:'worker-scheduled-jobs',dailyRowsReadLimit:2000000,learningDailyRowsReadLimit:250000,resetTimezone:'UTC',accountUsageMeasured:false,manualAndUserRequestsIncluded:false,bookkeepingIncluded:false,inFlightOvershootPossible:true});
const TABLE='lab_scheduled_read_usage',LANES='lab_scheduled_read_lanes';
export const scheduledBudgetLane=event=>['0,10,20,30,40,50 * * * *','15 * * * *'].includes(event.cron)?'learning':'collection';
const dayOf=now=>new Date(now).toISOString().slice(0,10);
const resetAt=now=>new Date(Date.parse(dayOf(now)+'T00:00:00Z')+86400000).toISOString();
async function ensure(db){await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(utc_day TEXT PRIMARY KEY,rows_read INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,unknown_queries INTEGER NOT NULL DEFAULT 0,quota_errors INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`).run();await db.prepare(`CREATE TABLE IF NOT EXISTS ${LANES}(utc_day TEXT NOT NULL,lane TEXT NOT NULL,rows_read INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(utc_day,lane))`).run();}
export async function scheduledReadStatus(db,now=Date.now()){
 let row;try{row=await db.prepare(`SELECT * FROM ${TABLE} WHERE utc_day=?`).bind(dayOf(now)).first();}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 let laneRows=[];try{laneRows=(await db.prepare(`SELECT lane,rows_read,queries FROM ${LANES} WHERE utc_day=?`).bind(dayOf(now)).all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 const learningRows=laneRows.find(r=>r.lane==='learning')?.rows_read||0,collectionRows=laneRows.find(r=>r.lane==='collection')?.rows_read||0;
 const paused=!!row&&(row.rows_read>=SCHEDULED_READ_BUDGET.dailyRowsReadLimit||row.unknown_queries>0||row.quota_errors>0);
 return {...SCHEDULED_READ_BUDGET,utcDay:dayOf(now),initialized:!!row,observedRowsRead:row?.rows_read??0,queries:row?.queries??0,unknownQueries:row?.unknown_queries??0,quotaErrors:row?.quota_errors??0,updatedAt:row?.updated_at??null,lanes:{collection:{observedRowsRead:collectionRows},learning:{observedRowsRead:learningRows,dailyRowsReadLimit:SCHEDULED_READ_BUDGET.learningDailyRowsReadLimit,paused:learningRows>=SCHEDULED_READ_BUDGET.learningDailyRowsReadLimit}},unattributedRowsRead:Math.max(0,(row?.rows_read||0)-learningRows-collectionRows),paused,reason:row?.quota_errors?'d1-daily-read-limit':row?.unknown_queries?'measurement-incomplete':paused?'scheduled-read-budget':null,nextResetAt:resetAt(now)};
}
export function meterScheduledDb(db,clock=Date.now,lane='collection'){
 const daily=new Map(),originals=new WeakMap();
 const bucket=()=>{const day=dayOf(clock());if(!daily.has(day))daily.set(day,{rows:0,queries:0,unknown:0,quota:0});return daily.get(day);};
 const record=result=>{const b=bucket(),rows=result?.meta?.rows_read;b.queries++;if(Number.isSafeInteger(rows)&&rows>=0)b.rows+=rows;else b.unknown++;};
 const execute=async fn=>{try{const result=await fn();if(Array.isArray(result))result.forEach(record);else record(result);return result;}catch(e){if(/exceeded D1.*daily row read limit/i.test(String(e)))bucket().quota++;throw e;}};
 const wrap=statement=>{const wrapped={bind:(...args)=>wrap(statement.bind(...args)),all:()=>execute(()=>statement.all()),run:()=>execute(()=>statement.run()),first:async column=>{const result=await execute(()=>statement.all()),row=result.results?.[0];if(!row)return null;if(column===undefined)return row;if(!Object.hasOwn(row,column))throw Error('D1_ERROR: Column not found');return row[column];}};originals.set(wrapped,statement);return wrapped;};
 const metered={prepare:sql=>wrap(db.prepare(sql)),batch:statements=>execute(()=>db.batch(statements.map(s=>originals.get(s)||s)))};
 return {db:metered,async flush(){for(const [day,b] of daily){await db.batch([db.prepare(`INSERT INTO ${TABLE}(utc_day,rows_read,queries,unknown_queries,quota_errors,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(utc_day) DO UPDATE SET rows_read=rows_read+excluded.rows_read,queries=queries+excluded.queries,unknown_queries=unknown_queries+excluded.unknown_queries,quota_errors=quota_errors+excluded.quota_errors,updated_at=excluded.updated_at`).bind(day,b.rows,b.queries,b.unknown,b.quota,new Date(clock()).toISOString()),db.prepare(`INSERT INTO ${LANES}(utc_day,lane,rows_read,queries) VALUES(?,?,?,?) ON CONFLICT(utc_day,lane) DO UPDATE SET rows_read=rows_read+excluded.rows_read,queries=queries+excluded.queries`).bind(day,lane,b.rows,b.queries)]);daily.delete(day);}}};
}
export async function runWithScheduledReadBudget(db,job,clock=Date.now,lane='collection'){
 // No work is dispatched when the durable budget cannot be read.
 await ensure(db);const status=await scheduledReadStatus(db,clock());if(status.paused||(lane==='learning'&&status.lanes.learning.paused))return {status:'paused',reason:status.reason||'learning-read-budget',budget:status};
 const meter=meterScheduledDb(db,clock,lane);try{return await job(meter.db);}finally{await meter.flush();}
}
