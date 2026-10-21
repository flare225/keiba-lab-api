// Operator verification only: three explicit targets, no retries or broad audits.
import {mkdir,writeFile} from 'node:fs/promises';
import {EXPECTED_ROSTER_SEEDS} from '../src/expected-roster-seeds.js';
const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev',targets=[{date:'2026-10-24',venue:'東京',raceNo:11},{date:'2026-10-25',venue:'京都',raceNo:11},{date:'2026-10-25',venue:'新潟',raceNo:11}],out='bounded-live-evidence';await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),requests:[],targets:[],counts:{newRosterRaces:0,newFormalCardRaces:0,newHistoryHorses:0,newHistoryRows:0,newPredictions:0,predictionReadbacks:0,rosterReadbacks:0,historyReadbacks:0},cached:{},quotaRecovered:false};let usedSourceSlot=false;
const query=t=>new URLSearchParams({date:t.date,venue:t.venue,race_no:String(t.raceNo)}).toString(),key=t=>`${t.date}:${t.venue}:${t.raceNo}`;
async function call(path,body,{allow404=false}={}){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','cache-control':'no-cache'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data={ok:false,error:raw.slice(0,500)}};
 const audit={path,method:body?'POST':'GET',httpStatus:response.status,ok:data.ok,error:data.error||null};report.requests.push(audit);console.log('LIVE_REQUEST',JSON.stringify(audit));
 if(/exceeded D1.*daily row read limit/i.test(raw)){const e=Error('D1 daily quota remains exceeded');e.quota=true;throw e;}
 if(allow404&&response.status===404)return null;if(!response.ok||data.ok!==true){const e=Error(JSON.stringify(audit));e.saveMayHaveSucceeded=data.saveMayHaveSucceeded;throw e;}return data;
}
try{
 const initial=await call('/v1/lab/automatic-prediction?'+query(targets[0]));report.quotaRecovered=true;report.firstDatabaseRead={available:initial.available,httpStatus:200,ok:true};
 for(const t of targets){const item={target:t,stages:{},error:null};report.targets.push(item);const q=query(t);try{
  const state=await call('/v1/lab/race-ops?'+q);report.cached[key(t)]={state};item.stages.card={status:state.status||'stored-state',formalCardSaved:state.ops?.cardComplete===true,gate:state.prelock?.gate||null};
  let roster=await call('/v1/lab/expected-runners?'+q,null,{allow404:true});const seed=EXPECTED_ROSTER_SEEDS.find(x=>x.record.date===t.date&&x.record.venue===t.venue&&x.record.raceNo===t.raceNo);
  if(seed&&(!roster||!roster.source?.snapshotId?.startsWith('registered:'))){await call('/v1/lab/expected-roster-seed-import',{snapshotId:seed.snapshotId,confirm:'IMPORT_BUNDLED'});roster=await call('/v1/lab/expected-runners?'+q);report.counts.newRosterRaces++;}
  if(!roster)throw Error('No registered expected roster');if(seed&&JSON.stringify(roster.runners.map(r=>r.horseName).sort())!==JSON.stringify(seed.record.runners.map(r=>r.horseName).sort()))throw Error('Roster differs from reviewed source');report.counts.rosterReadbacks++;report.cached[key(t)].roster=roster;item.stages.roster={runnerCount:roster.runners.length,snapshotId:roster.source?.snapshotId,sourceUrl:roster.source?.sourceUrl||null,independentReadback:true};
  const before=await call('/v1/lab/reviewed-upcoming-history?'+q);let history=before;
  if(!before.available){const imported=await call('/v1/lab/reviewed-upcoming-history',{...t,confirm:'IMPORT_BUNDLED'});history=await call('/v1/lab/reviewed-upcoming-history?'+q);if(history.sha256!==imported.sha256)throw Error('History import/readback hash mismatch');report.counts.newHistoryRows+=Number(imported.savedRows)||0;report.counts.newHistoryHorses+=history.horses?.length||0;}
  if(!history.integrityVerified)throw Error('History readback not verified');report.counts.historyReadbacks++;report.cached[key(t)].history=history;item.stages.history={available:true,storedRows:history.storedRows,horseCount:history.horses.length,sha256:history.sha256,sourceUrl:history.sourceUrl,independentReadback:true,newRows:before.available?0:history.storedRows};
  if(!item.stages.card.formalCardSaved){
   if(!usedSourceSlot){const status=await call('/v1/lab/expected-history-status?'+q);const until=Math.max(Number(status.gate?.locked_until)||0,Number(status.gate?.next_batch_at)||0);item.sharedGate=status.gate||null;
    if(until>Date.now()){item.sourceAttempt={status:'cooldown',nextAttemptAt:new Date(until).toISOString()};usedSourceSlot=true;}
    else{usedSourceSlot=true;try{const delivery=await call('/v1/lab/missing-official-card-batch',{...t,confirm:'COLLECT'});item.sourceAttempt=delivery;if(delivery.formalCardSaved){report.counts.newFormalCardRaces++;const reread=await call('/v1/lab/race-ops?'+q);report.cached[key(t)].state=reread;item.stages.card={formalCardSaved:reread.ops?.cardComplete===true,status:reread.status||'stored-state'};}}catch(e){if(e.quota)throw e;item.sourceAttempt={status:'source-or-save-failed',error:e.message,saveMayHaveSucceeded:!!e.saveMayHaveSucceeded};}}
   }
   if(!item.stages.card.formalCardSaved){item.stages.prediction={status:'blocked-formal-card-not-saved',newSaved:0};item.stoppedAt='formal-card';continue;}
  }
  const readiness=await call('/v1/lab/prelock-readiness?'+q),start=readiness.program?.start_time,cutoff=/^\d{2}:\d{2}$/.test(start||'')?Date.parse(`${t.date}T${start}:00+09:00`)-300000:NaN;item.officialStart=start||null;
  if(!Number.isFinite(cutoff)||Date.now()>=cutoff){item.stoppedAt='future-start-verification';item.stages.prediction={status:'not-eligible-for-new-pre-race-capture'};continue;}
  const saved=await call('/v1/lab/automatic-prediction',{...t,confirm:'CAPTURE'});report.counts.newPredictions+=Number(saved.saved)||0;if(!saved.available){item.stoppedAt='independent-prediction';item.stages.prediction=saved;continue;}
  const read=await call('/v1/lab/automatic-prediction?'+q);if(!read.integrityVerified||read.snapshotSha256!==saved.snapshotSha256||JSON.stringify(read.snapshot)!==JSON.stringify(saved.snapshot))throw Error('Independent prediction readback mismatch');report.counts.predictionReadbacks++;report.cached[key(t)].prediction=read;item.stages.prediction={status:'saved-immutable-readback-verified',sha256:read.snapshotSha256,savedAt:read.snapshot.savedAt,modelVersion:read.snapshot.modelVersion,runnerCount:read.snapshot.runners.length,newSaved:saved.saved,immutable:read.snapshot.guardrails?.immutable};
 }catch(e){item.error=e.message;item.saveMayHaveSucceeded=!!e.saveMayHaveSucceeded;if(e.quota)throw e;}}
}catch(e){report.blocked={error:e.message,quota:!!e.quota};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('BOUNDED_LIVE_REPORT',JSON.stringify({...report,cached:undefined,requests:undefined}));}
