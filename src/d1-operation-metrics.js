// Per-operation D1 metadata; does not add queries or replace the outer daily budget.
export async function measureD1Operation(db,work,clock=Date.now){
 const start=clock(),originals=new WeakMap();let read=0,written=0,queries=0,unknown=0;
 const record=r=>{queries++;const a=r?.meta?.rows_read,b=r?.meta?.rows_written;if(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0){read+=a;written+=b;}else unknown++;};
 const execute=async f=>{const r=await f();if(Array.isArray(r))r.forEach(record);else record(r);return r};
 const wrap=s=>{const w={bind:(...a)=>wrap(s.bind(...a)),all:()=>execute(()=>s.all()),run:()=>execute(()=>s.run()),first:async column=>{const r=await execute(()=>s.all()),row=r.results?.[0];return row?(column===undefined?row:row[column]):null;}};originals.set(w,s);return w};
 const measured={prepare:q=>wrap(db.prepare(q)),batch:ss=>execute(()=>db.batch(ss.map(s=>originals.get(s)||s)))};
 const result=await work(measured);
 return{...result,metrics:{durationMs:Math.max(0,clock()-start),queries,rowsRead:unknown?null:read,rowsWritten:unknown?null:written,unknownQueries:unknown,measurementComplete:unknown===0,scope:'this-operation-only',pipelineBookkeepingIncluded:false,accountUsageMeasured:false}};
}
