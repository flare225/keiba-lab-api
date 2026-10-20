import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {meterScheduledDb,runWithScheduledReadBudget,scheduledReadStatus,scheduledBudgetLane,observedQuotaPause} from '../src/scheduled-read-budget.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE data(n INTEGER);INSERT INTO data VALUES(7),(9)');let queue=Promise.resolve();const db={prepare(q){return statement(q,[]);},batch(items){const task=queue.then(async()=>{sql.exec('BEGIN');try{const result=await Promise.all(items.map(x=>x.all()));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}});queue=task.catch(()=>{});return task;}};function statement(q,args){return{bind:(...a)=>statement(q,a),async all(){const s=sql.prepare(q);let results=[],changes=0;if(s.columns().length)results=s.all(...args);else changes=Number(s.run(...args).changes);return{success:true,results,meta:{rows_read:q.includes('FROM data')?20:1,changes}};},async run(){return this.all();},async first(column){const row=(await this.all()).results[0];return row?(column===undefined?row:row[column]):null;}}}return{db,sql};}
const today=Date.parse('2026-10-15T00:20:00Z');
test('actual metadata counts scanned rows rather than returned rows; first and batch preserve values and statements',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async measured=>{assert.equal((await measured.prepare('SELECT n FROM data').first()).n,7);assert.equal(await measured.prepare('SELECT n FROM data WHERE n=?').bind(9).first('n'),9);assert.equal(await measured.prepare('SELECT n FROM data WHERE n=0').first(),null);await assert.rejects(measured.prepare('SELECT n FROM data').first('absent'),/Column not found/);const rows=await measured.batch([measured.prepare('SELECT n FROM data WHERE n=?').bind(7),measured.prepare('INSERT INTO data VALUES(?)').bind(11)]);assert.equal(rows[0].results[0].n,7);assert.equal(rows[1].meta.changes,1);},()=>today);
 const s=await scheduledReadStatus(db,today);assert.equal(s.observedRowsRead,101);assert.equal(s.queries,6);assert.equal(s.unknownQueries,0);assert.equal(s.accountUsageMeasured,false);assert.equal(s.manualAndUserRequestsIncluded,false);assert.equal(s.authorizedAutomaticTrainingIncluded,true);assert.equal(s.nextResetAt,'2026-10-16T00:00:00.000Z');sql.close();
});
test('atomic accumulation from concurrent invocations; threshold skips next job; UTC rollover resumes',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);const a=meterScheduledDb(db,()=>today),b=meterScheduledDb(db,()=>today);await a.db.prepare('SELECT n FROM data').all();await b.db.prepare('SELECT n FROM data').all();await Promise.all([a.flush(),b.flush()]);assert.equal((await scheduledReadStatus(db,today)).observedRowsRead,40);
 sql.prepare('UPDATE lab_scheduled_read_usage SET rows_read=2000000').run();let calls=0;const result=await runWithScheduledReadBudget(db,async()=>{calls++;},()=>today);assert.equal(result.status,'paused');assert.equal(result.budget.reason,'scheduled-read-budget');assert.equal(calls,0);await runWithScheduledReadBudget(db,async measured=>{calls++;await measured.prepare('SELECT n FROM data').all();},()=>today+86400000);assert.equal(calls,1);assert.equal((await scheduledReadStatus(db,today+86400000)).observedRowsRead,20);sql.close();
});
test('missing metadata pauses later jobs rather than claiming a complete zero count; failed budget read dispatches nothing',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);const original=db.prepare.bind(db),missing={...db,prepare(q){if(q==='missing')return{all:async()=>({results:[]})};return original(q);}};const meter=meterScheduledDb(missing,()=>today);await meter.db.prepare('missing').all();await meter.flush();const s=await scheduledReadStatus(db,today);assert.equal(s.reason,'measurement-incomplete');assert.equal(s.unknownQueries,1);
 let calls=0;await assert.rejects(runWithScheduledReadBudget({prepare(){throw Error('D1 unavailable');}},async()=>calls++,()=>today),/unavailable/);assert.equal(calls,0);sql.close();
});
test('quota errors propagate and stop further queries without writing a failed quota ledger',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);const original=db.prepare.bind(db),failed={...db,prepare(q){if(q==='failed')return{all:async()=>{throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");}};return original(q);}};const meter=meterScheduledDb(failed,()=>today);await assert.rejects(meter.db.prepare('failed').first(),/daily row read limit/);const flushed=await meter.flush();assert.equal(flushed.saved,false);assert.equal(flushed.reason,'d1-daily-read-limit');assert.equal(observedQuotaPause(failed,today).nextResetAt,'2026-10-16T00:00:00.000Z');assert.equal((await scheduledReadStatus(db,today)).quotaErrors,0);sql.close();
});
test('work crossing UTC midnight is attributed to the day of each query, even when flushing later',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);let now=Date.parse('2026-10-15T23:59:59Z');const meter=meterScheduledDb(db,()=>now);await meter.db.prepare('SELECT n FROM data').all();now+=2000;await meter.db.prepare('SELECT n FROM data').all();await meter.flush();assert.equal((await scheduledReadStatus(db,today)).observedRowsRead,20);assert.equal((await scheduledReadStatus(db,today+86400000)).observedRowsRead,20);sql.close();
});

test('learning cap leaves collection running; old aggregate usage is retained without inventing lane attribution',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);
 sql.prepare("INSERT INTO lab_scheduled_read_usage VALUES(?,?,?,?,?,?)").run('2026-10-15',270358,2342,0,0,new Date(today).toISOString());
 sql.prepare("INSERT INTO lab_scheduled_read_lanes VALUES(?,?,?,?)").run('2026-10-15','learning',250000,12);
 const before=await scheduledReadStatus(db,today);assert.equal(before.unattributedRowsRead,20358);assert.equal(before.lanes.learning.paused,true);assert.equal(before.paused,false);
 let calls=0;assert.equal((await runWithScheduledReadBudget(db,async()=>calls++,()=>today,'learning')).reason,'learning-read-budget');assert.equal(calls,0);
 await runWithScheduledReadBudget(db,async measured=>{calls++;await measured.prepare('SELECT n FROM data').all();},()=>today,'collection');assert.equal(calls,1);const after=await scheduledReadStatus(db,today);assert.equal(after.observedRowsRead,270378);assert.equal(after.lanes.collection.observedRowsRead,20);assert.equal(after.unattributedRowsRead,20358);
 assert.equal(scheduledBudgetLane({cron:'0,10,20,30,40,50 * * * *'}),'learning');assert.equal(scheduledBudgetLane({cron:'*/3 * * * *'}),'collection');assert.equal(scheduledBudgetLane({cron:'0 * * * *'}),'collection');sql.close();
});
test('aggregate and lane accounting commit atomically, retaining pending usage after a failed flush',async()=>{
 const {db,sql}=fixture();await runWithScheduledReadBudget(db,async()=>{},()=>today);const meter=meterScheduledDb(db,()=>today,'learning');await meter.db.prepare('SELECT n FROM data').all();
 sql.exec("CREATE TRIGGER reject_lane BEFORE INSERT ON lab_scheduled_read_lanes BEGIN SELECT RAISE(ABORT,'reject telemetry');END");await assert.rejects(meter.flush(),/reject telemetry/);assert.equal((await scheduledReadStatus(db,today)).observedRowsRead,0);
 sql.exec('DROP TRIGGER reject_lane');await meter.flush();const s=await scheduledReadStatus(db,today);assert.equal(s.observedRowsRead,20);assert.equal(s.lanes.learning.observedRowsRead,20);sql.close();
});
test('quota failure during budget setup stops later scheduled invocations without DB calls until UTC rollover',async()=>{
 const {db,sql}=fixture();let failing=true,calls=0,jobs=0,stamp=today;const limited={prepare(q){calls++;if(failing)throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");return db.prepare(q);},batch:items=>db.batch(items)};
 const first=await runWithScheduledReadBudget(limited,async()=>jobs++,()=>stamp);assert.equal(first.reason,'d1-daily-read-limit');assert.equal(first.telemetrySaved,false);assert.equal(calls,1);assert.equal(jobs,0);
 failing=false;const second=await runWithScheduledReadBudget(limited,async()=>jobs++,()=>stamp);assert.equal(second.scope,'worker-isolate-db-binding');assert.equal(calls,1);assert.equal(jobs,0);
 stamp=Date.parse('2026-10-16T00:00:00Z');await runWithScheduledReadBudget(limited,async()=>jobs++,()=>stamp);assert.equal(jobs,1);assert.ok(calls>1);assert.equal(observedQuotaPause(limited,stamp),null);sql.close();
});
test('a swallowed job quota error cannot continue DB work or bookkeeping and is reported as paused',async()=>{
 const {db,sql}=fixture();let sourceCalls=0,batches=0;const limited={prepare(q){if(q==='fail')return{all:async()=>{sourceCalls++;throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");}};return db.prepare(q);},batch:items=>{batches++;return db.batch(items);}};
 const result=await runWithScheduledReadBudget(limited,async measured=>{
  await assert.rejects(measured.prepare('fail').all(),/daily row read limit/);
  assert.throws(()=>measured.prepare('SELECT n FROM data'),/paused until/);
  await assert.rejects(measured.batch([]),/paused until/);
  return{status:'complete'};
 },()=>today);
 assert.equal(result.status,'paused');assert.equal(result.telemetrySaved,false);assert.equal(sourceCalls,1);assert.equal(batches,0);sql.close();
});
test('ordinary DB failures do not acquire a false daily quota pause',async()=>{
 let calls=0;const db={prepare(){calls++;throw Error('schema incompatible');}};
 await assert.rejects(runWithScheduledReadBudget(db,async()=>{},()=>today),/schema/);await assert.rejects(runWithScheduledReadBudget(db,async()=>{},()=>today),/schema/);assert.equal(calls,2);assert.equal(observedQuotaPause(db,today),null);
});
test('quota pause preserves an uncertain-write flag instead of inviting a replay',async()=>{
 const {db,sql}=fixture();const result=await runWithScheduledReadBudget(db,async()=>{throw Object.assign(Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."),{saveMayHaveSucceeded:true});},()=>today);assert.equal(result.status,'paused');assert.equal(result.saveMayHaveSucceeded,true);assert.equal(result.retryWrite,false);sql.close();
});
