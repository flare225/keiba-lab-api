import {ADDITIONAL_WEEK_REVIEWED} from '../src/additional-week-reviewed-history.js';
const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
async function call(path,body,missing=false){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)}),d=await r.json();if(missing&&r.status===404)return null;if(!r.ok||!d.ok)throw Error(JSON.stringify({path,httpStatus:r.status,data:d}));return d;}
const budget=await call('/v1/lab/scheduled-read-budget');console.log('BUDGET',JSON.stringify(budget.budget));if(budget.budget.paused){console.log('STOP',JSON.stringify({reason:'read-budget-paused'}));process.exit(0);}
for(const c of ADDITIONAL_WEEK_REVIEWED){
 const {date,venue,raceNo}=c.seed.record,target={date,venue,raceNo},q=new URLSearchParams({date,venue,race_no:String(raceNo)});
 const before=await call('/v1/lab/expected-runners?'+q,null,true);
 const saved=before?null:await call('/v1/lab/expected-roster-seed-import',{snapshotId:c.seed.snapshotId,confirm:'IMPORT_BUNDLED'});
 const roster=await call('/v1/lab/expected-runners?'+q),expected=c.seed.record.runners.map(h=>[h.horseName,h.age]).sort();
 if(!roster.source.snapshotId.startsWith('registered:')||JSON.stringify(roster.runners.map(h=>[h.horseName,h.age]).sort())!==JSON.stringify(expected)||saved&&roster.source.snapshotId!=='registered:'+saved.snapshotId)throw Error('Independent roster readback failed');
 console.log('ADDITIONAL_ROSTER_VERIFIED',JSON.stringify({target,newRaces:before?0:1,runnerCount:roster.runners.length,snapshotId:roster.source.snapshotId,formalCardSaved:false}));
 const old=await call('/v1/lab/reviewed-upcoming-history?'+q);
 const imported=old.available?{...old,savedRows:0}:await call('/v1/lab/reviewed-upcoming-history',{...target,confirm:'IMPORT_BUNDLED'});
 const read=await call('/v1/lab/reviewed-upcoming-history?'+q);
 if(!read.integrityVerified||read.sha256!==imported.sha256||read.rows.length!==c.rows.length||read.horses.length!==c.seed.record.runners.length||read.omittedStarts.length!==c.omittedStarts.length)throw Error('Independent history readback failed');
 console.log('ADDITIONAL_HISTORY_VERIFIED',JSON.stringify({target,newRows:imported.savedRows,newHistoryHorses:old.available?0:read.horses.length,storedRows:read.rows.length,sha256:read.sha256,omittedStarts:read.omittedStarts,externalRequests:0}));
}
const inventory=await call('/v1/lab/week-data-inventory?from=2026-10-24&to=2026-10-25');console.log('WEEK_INVENTORY',JSON.stringify({summary:inventory.summary,withoutRoster:inventory.races.filter(r=>!r.runnerCount).map(r=>r.raceKey),guardrails:inventory.guardrails}));
