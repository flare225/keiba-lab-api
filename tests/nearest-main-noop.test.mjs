import test from 'node:test';
import assert from 'node:assert/strict';
import {runFocusedScheduled} from '../src/focused-race-completion.js';
test('serial focus only tries the next eligible main after a proven program no-op',async()=>{
 const t=(d,venue,raceNo)=>({date:'2026-11-'+d,venue,raceNo,expiresAt:'2026-11-'+d+'T15:35:00+09:00'});
 const p=t(29,'京都',12),a=t(28,'東京',11),b=t(28,'京都',11);
 const env={LAB_FINISH_NEAREST_MAIN:'true',LAB_COMPLETION_MAIN_TARGETS:JSON.stringify([a,b]),LAB_COMPLETION_PREPARATION_TARGETS:JSON.stringify([a,b])};
 const idle={ok:true,status:'focused-program-not-due',externalRequests:0};
 for(const [first,venues] of [[idle,['東京','京都']],[{...idle,status:'cooldown'},['東京']],[{...idle,externalRequests:1},['東京']],[{...idle,status:'saved'},['東京']]]){
  const seen=[];
  await runFocusedScheduled({cron:'*/3 * * * *'},env,p,{now:()=>Date.parse('2026-11-26T14:05:00+09:00'),readSeal:async()=>({}),readiness:async()=>({ok:false}),coordinate:async(_,__,o)=>o.jobs.history({}),prepareRoster:async()=>({saved:0,externalRequests:0,status:'no-reviewed-candidate'}),collect:async(_,target)=>{seen.push(target.venue);return seen.length===1?first:{ok:true,status:'saved',externalRequests:1}}});
  assert.deepEqual(seen,venues);
 }
});
