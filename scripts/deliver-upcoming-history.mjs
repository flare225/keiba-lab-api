// Bounded operator delivery; no retries and no credential access.
const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
const targets=[{date:'2026-10-25',venue:'京都',raceNo:11},{date:'2026-10-24',venue:'東京',raceNo:11}];
async function request(path,body){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','cache-control':'no-cache'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok||data.ok!==true)throw Error(JSON.stringify({path,status:response.status,data}));return data;
}
const budget=await request('/v1/lab/scheduled-read-budget');console.log('BUDGET',JSON.stringify(budget.budget));
if(budget.budget.paused){console.log('STOP',JSON.stringify({reason:budget.budget.reason,nextResetAt:budget.budget.nextResetAt}));process.exit(0)}
for(const target of targets){
 const query=new URLSearchParams({date:target.date,venue:target.venue,race_no:String(target.raceNo)}),path='/v1/lab/expected-history-status?'+query;
 const before=await request(path);if(before.races.length!==1||before.races[0].date!==target.date||before.races[0].venue!==target.venue)throw Error('Target-scoped status is required');
 console.log('BEFORE',JSON.stringify({target,...before}));
 const until=Math.max(Number(before.gate?.next_batch_at)||0,Number(before.gate?.locked_until)||0);
 if(until>Date.now()){console.log('STOP',JSON.stringify({target,reason:'shared-cooldown',nextAttemptAt:new Date(until).toISOString()}));break}
 // A returned cooldown/waiting is a real outcome, never a reason to retry.
 const response=await fetch(base+'/v1/lab/expected-history-batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...target,confirm:'COLLECT'}),signal:AbortSignal.timeout(45000)});
 const result=await response.json();console.log('DELIVERY',JSON.stringify({target,httpStatus:response.status,result}));
 // READ independently even when delivery reports a source error. Never resend uncertain writes.
 const after=await request(path);console.log('AFTER',JSON.stringify({target,...after}));
 const old=new Map(before.races[0].runners.map(r=>[r.horseName,r.storedRows]));
 const changed=after.races[0].runners.filter(r=>r.storedRows>(old.get(r.horseName)||0));
 console.log('VERIFIED_DELTA',JSON.stringify({target,horses:changed.map(r=>({horseName:r.horseName,before:old.get(r.horseName)||0,after:r.storedRows})),addedRows:changed.reduce((n,r)=>n+r.storedRows-(old.get(r.horseName)||0),0),externalRequests:result.externalRequests??null}));
 if(result.status==='cooldown'||result.externalRequests>0||!response.ok||result.ok===false)break;
}
