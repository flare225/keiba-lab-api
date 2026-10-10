import {pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';
export const DATE='2026-10-11';
export const VENUES=['東京','京都'];
export const raceKey=(v,n)=>`${DATE}:${v}:${n}`;
export const keys=VENUES.flatMap(v=>Array.from({length:12},(_,i)=>raceKey(v,i+1)));
const num=v=>v===null||v===undefined||v===''?null:Number(v);

export function inspectCoverage(audit){
 const stored=new Map((audit?.races||[]).map(r=>[r.program_key||raceKey(r.venue,Number(r.race_no)),r]));
 const rows=keys.map(key=>{
  const row=stored.get(key);
  const count=num(row?.stored_runners)||0,expected=num(row?.runner_count)||0;
  const complete=!!row?.race_key&&expected>0&&count===expected&&row.complete===true;
  const verified=complete&&row.officialCountVerified===true;
  return {raceKey:key,program:!!row,card:!!row?.race_key,expected,stored:count,verified,
   errors:[...(!row?['program-missing']:[]),...(row&&!row.race_key?['card-missing']:[]),
    ...(row?.race_key&&!complete?['card-incomplete']:[]),
    ...(complete&&!verified?['source-evidence-unverified']:[])]};
 });
 return {rows,ok:rows.length===24&&rows.every(x=>x.verified)};
}

export function inspectRunners(body,key,expected){
 if(!body?.ok||body.raceKey!==key||!Array.isArray(body.data))
  return {raceKey:key,ok:false,count:0,errors:['invalid-runner-api-response']};
 const names=new Set(),numbers=new Set(),errors=[];
 for(const runner of body.data){
  const name=String(runner.horse_name??runner.horseName??'').trim();
  const no=num(runner.horse_no??runner.horseNo),frame=num(runner.frame_no??runner.frameNo);
  if(!name||names.has(name))errors.push('duplicate-or-empty-name');
  if(!Number.isInteger(no)||no<1||no>18||numbers.has(no))errors.push('invalid-or-duplicate-number');
  if(!Number.isInteger(frame)||frame<1||frame>8)errors.push('frame-missing');
  names.add(name);numbers.add(no);
 }
 if(!body.data.length)errors.push('no-runners');
 if(body.data.length!==num(body.count))errors.push('api-count-mismatch');
 if(expected>0&&body.data.length!==expected)errors.push('db-count-mismatch');
 if(body.data.length&&[...numbers].sort((a,b)=>a-b).some((n,i)=>n!==i+1))errors.push('noncontiguous-numbers');
 return{raceKey:key,ok:errors.length===0,count:body.data.length,errors:[...new Set(errors)]};
}
const URL_BASE='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
async function read(path){
 const response=await fetch(URL_BASE+path,{method:'GET',signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});
 let data;
 try{data=await response.json()}catch{throw Error('Non-JSON HTTP '+response.status);}
 if(!response.ok)throw Error('HTTP '+response.status+': '+String(data.error||'failed').slice(0,100));
 return data;
}
export async function inspectLive(fetchFn=read){
 const audit=await fetchFn('/v1/lab/storage-audit?from='+DATE+'&to='+DATE);
 if(audit.stage!=='all-race-storage-audit'||audit.from!==DATE||audit.to!==DATE)
  throw Error('Storage audit did not prove the requested date');
 const coverage=inspectCoverage(audit),rosters=[];
 for(const row of coverage.rows){
  try{rosters.push(inspectRunners(await fetchFn('/api/jra/runners?race_key='+encodeURIComponent(row.raceKey)),row.raceKey,row.expected));}
  catch(e){rosters.push({raceKey:row.raceKey,ok:false,count:0,errors:['read-error:'+String(e.message||e)]});}
 }
 return{coverage,rosters,ok:coverage.ok&&rosters.every(r=>r.ok)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await inspectLive();
  const issues=result.coverage.rows.map((r,i)=>({raceKey:r.raceKey,stored:r.stored,expected:r.expected,verified:r.verified,
   problems:[...r.errors,...result.rosters[i].errors]})).filter(x=>x.problems.length);
  console.log('CARD_COVERAGE',JSON.stringify({date:DATE,programmed:result.coverage.rows.filter(x=>x.program).length,
   stored:result.coverage.rows.filter(x=>x.card).length,verified:result.coverage.rows.filter(x=>x.verified).length,expected:24,issues}));
  if(process.env.GITHUB_STEP_SUMMARY){
   const lines=['## 2026-10-11 JRA card and roster DB verification','Read-only 25 API requests; no writes or result data.',
    '| Race | Card | Runner count | Source evidence | Problems |','|---|---|---:|---|---|'];
   for(let i=0;i<result.coverage.rows.length;i++){
    const r=result.coverage.rows[i],ro=result.rosters[i];
    lines.push('| '+r.raceKey.replace(DATE+':','')+' | '+(r.card?'yes':'NO')+' | '+ro.count+'/'+(r.expected||'?')+' | '+(r.verified?'yes':'NO')+' | '+[...r.errors,...ro.errors].join(', ').replaceAll('|','/')+' |');
   }
   lines.push('',result.ok?'**PASS: 24/24 officially verified race rosters.**':'**BLOCKED: complete official numbered card coverage not verified.**');
   appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
  }
  if(!result.ok)process.exitCode=1;
 }catch(e){console.error('AUDIT_UNAVAILABLE',String(e.message||e));process.exitCode=1;}
}
