// Per-operation D1 metadata; does not add queries or replace the outer daily budget.
export async function measureD1Operation(db,work,clock=Date.now){
 const start=clock(),originals=new WeakMap();const breakdown=[];let read=0,written=0,queries=0,unknown=0;
 const record=(r,label)=>{queries++;const a=r?.meta?.rows_read,b=r?.meta?.rows_written;if(breakdown.length<40)breakdown.push({statement:label,rowsRead:Number.isSafeInteger(a)?a:null,rowsWritten:Number.isSafeInteger(b)?b:null});if(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0){read+=a;written+=b;}else unknown++;};
 const execute=async (f,label)=>{const r=await f();if(Array.isArray(r))r.forEach(x=>record(x,label));else record(r,label);return r};
 const wrap=(s,label)=>{const w={bind:(...a)=>wrap(s.bind(...a),label),all:()=>execute(()=>s.all(),label),run:()=>execute(()=>s.run(),label),first:async column=>{const r=await execute(()=>s.all(),label),row=r.results?.[0];return row?(column===undefined?row:row[column]):null;}};originals.set(w,s);return w};
 const measured={prepare:q=>wrap(db.prepare(q),q.replace(/'[^']*'/g,'?').replace(/\s+/g,' ').slice(0,240)),batch:ss=>execute(()=>db.batch(ss.map(s=>originals.get(s)||s)),'batch')};
 const result=await work(measured);
 return{...result,metrics:{statements:breakdown,durationMs:Math.max(0,clock()-start),queries,rowsRead:unknown?null:read,rowsWritten:unknown?null:written,unknownQueries:unknown,measurementComplete:unknown===0,scope:'this-operation-only',pipelineBookkeepingIncluded:false,accountUsageMeasured:false}};
}
