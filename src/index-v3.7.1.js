import app from './index-v3.7.0.js';
import {fetchHtml, extractLinks, metaFromRacecardUrl, parseRace} from './index-v1.1.4.js';
import {persistFullDay} from './index.js';

const VERSION='3.7.1';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
export function validDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(`${date}T00:00:00Z`))&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
const keyOf=(date,venue,raceNo)=>`${date}:${venue}:${raceNo}`;
export function matches(meta,date,venue,raceNo){return !!meta&&meta.date===date&&meta.venue===venue&&meta.raceNo===Number(raceNo);}
export function validateCard(race){
 const numbers=race.runners.map(x=>x.horseNo);
 return race.runnerCount>0&&race.runnerCount<=18&&numbers.length===race.runnerCount&&new Set(numbers).size===numbers.length&&numbers.every((x,i)=>Number.isInteger(x)&&x===i+1)&&race.runners.every(x=>x.name);
}

// Follow only links actually published by JRA. No guessed CNAME/checksum URLs.
async function discover(date,programs){
 const found=new Map(),queue=['https://www.jra.go.jp/keiba/','https://www.jra.go.jp/'],visited=new Set(),errors=[];
 for(const p of programs)if(p.source_url&&!queue.includes(p.source_url))queue.push(p.source_url);
 while(queue.length&&visited.size<6){
  const url=queue.shift();if(visited.has(url))continue;visited.add(url);
  let page;try{page=await fetchHtml(url);}catch(error){errors.push({url,error:String(error)});continue;}
  if(!page.ok){errors.push({url,status:page.status});continue;}
  for(const link of extractLinks(page.body,page.url)){
   const meta=metaFromRacecardUrl(link);
   if(meta?.date===date&&programs.some(p=>matches(meta,date,p.venue,p.race_no))){
    const key=keyOf(date,meta.venue,meta.raceNo);
    if(!found.has(key)||meta.detailed)found.set(key,meta);
    if(![...visited,...queue].some(x=>metaFromRacecardUrl(x)?.venue===meta.venue)&&!visited.has(link))queue.push(link);
   }
   // Meeting selectors lead to published race links; keep the traversal bounded.
   if(!meta&&/JRADB\/accessD\.html/.test(link)&&/pw01d/.test(link)&&!visited.has(link)&&!queue.includes(link))queue.push(link);
  }
 }
 return {found,errors,pagesVisited:visited.size};
}

export async function storageAudit(db,from,to){
 const rows=(await db.prepare(`SELECT p.program_key,p.race_date,p.venue,p.race_no,p.grade,r.race_key,r.runner_count,
 COUNT(rr.horse_no) AS stored_runners,COUNT(DISTINCT rr.horse_no) AS unique_runners,
 SUM(CASE WHEN rr.horse_no IS NOT NULL AND (rr.horse_no<1 OR rr.horse_no>18 OR rr.horse_name IS NULL OR TRIM(rr.horse_name)='') THEN 1 ELSE 0 END) AS invalid_runners
 FROM jra_race_program p LEFT JOIN jra_races r ON r.race_date=p.race_date AND r.venue=p.venue AND r.race_no=p.race_no
 LEFT JOIN jra_runners rr ON rr.race_key=r.race_key WHERE p.race_date BETWEEN ? AND ?
 GROUP BY p.program_key,p.race_date,p.venue,p.race_no,p.grade,r.race_key,r.runner_count ORDER BY p.race_date,p.venue,p.race_no`).bind(from,to).all()).results||[];
 const anomalies=(await db.prepare(`SELECT r.race_key,'card-without-program' AS reason FROM jra_races r LEFT JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no WHERE r.race_date BETWEEN ? AND ? AND p.program_key IS NULL
 UNION ALL SELECT rr.race_key,'runner-without-card' AS reason FROM jra_runners rr LEFT JOIN jra_races r ON r.race_key=rr.race_key WHERE r.race_key IS NULL AND SUBSTR(rr.race_key,1,10) BETWEEN ? AND ?`).bind(from,to,from,to).all()).results||[];
 const races=rows.map(r=>({...r,complete:!!r.race_key&&Number(r.runner_count)>0&&Number(r.runner_count)===Number(r.stored_runners)&&Number(r.unique_runners)===Number(r.stored_runners)&&!Number(r.invalid_runners)&&r.race_key===r.program_key}));
 const dates=[...new Set(rows.map(x=>x.race_date))].map(date=>{
  const rs=races.filter(x=>x.race_date===date);
  return {date,programRaces:rs.length,gradedProgramRaces:rs.filter(x=>x.grade).length,raceCardsStored:rs.filter(x=>x.race_key).length,completeRaceCards:rs.filter(x=>x.complete).length,declaredRunners:rs.reduce((s,x)=>s+Number(x.runner_count||0),0),runnersStored:rs.reduce((s,x)=>s+Number(x.stored_runners||0),0)};
 });
 const totals=dates.reduce((a,x)=>{for(const k of ['programRaces','gradedProgramRaces','raceCardsStored','completeRaceCards','declaredRunners','runnersStored'])a[k]=(a[k]||0)+x[k];return a;},{programRaces:0,gradedProgramRaces:0,raceCardsStored:0,completeRaceCards:0,declaredRunners:0,runnersStored:0});
 return {ok:anomalies.length===0&&!races.some(x=>x.race_key&&!x.complete),stage:'all-race-storage-audit',version:VERSION,from,to,totals,dates,races,anomalies,allCardsComplete:!!races.length&&races.every(x=>x.complete)&&!anomalies.length,missingCards:races.filter(x=>!x.race_key).map(x=>x.program_key),note:'declaredRunners is the card parser count; independent official total verification is still required before LOCK.'};
}

export async function ingestDay(request,env,ctx,deps={discover,fetchHtml,parseRace,persistFullDay}){
 const u=new URL(request.url),date=u.searchParams.get('date');
 if(!validDate(date))throw new Error('date=valid YYYY-MM-DD is required');
 const cursor=Number(u.searchParams.get('cursor')||0),limit=Number(u.searchParams.get('limit')||8);
 if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>8)throw new Error('cursor >= 0, limit=1-8 required');
 const programs=(await env.DB.prepare('SELECT program_key,race_date,venue,race_no,source_url FROM jra_race_program WHERE race_date=? ORDER BY venue,race_no').bind(date).all()).results||[];
 if(!programs.length)throw new Error('No staged program for requested date');
 const discovery=await deps.discover(date,programs),runs=[];
 for(const p of programs.slice(cursor,cursor+limit)){
  const raceKey=keyOf(date,p.venue,p.race_no),meta=discovery.found.get(raceKey);
  if(!meta){runs.push({raceKey,ok:false,status:'card-not-discovered',error:'Publication status is unverified; discovery failure is not proof of unpublished cards'});continue;}
  try{
   const page=await deps.fetchHtml(meta.url),resolved=metaFromRacecardUrl(page.url);
   if(!page.ok||!matches(resolved,date,p.venue,p.race_no))throw new Error('Source HTTP failure or redirected race identity mismatch');
   const race=deps.parseRace(page,date,p.venue,Number(p.race_no));
   if(!validateCard(race))throw new Error('Empty, duplicate, invalid or non-contiguous runner numbers');
   const result=await deps.persistFullDay(env.DB,{date,races:[race]});
   const saved=result.saved?.find(x=>x.raceKey===raceKey&&x.status==='saved');
   if(!saved)throw new Error('Target race was not confirmed saved');
   runs.push({raceKey,ok:true,status:'saved',runnerCount:saved.runnerCount});
  }catch(error){runs.push({raceKey,ok:false,status:'failed',error:String(error)});}
 }
 const nextCursor=cursor+limit<programs.length?cursor+limit:null;
 return {ok:runs.length>0&&runs.every(x=>x.ok),stage:'all-race-card-ingest',version:VERSION,date,programRaceCount:programs.length,attempted:runs.length,storedRaceCards:runs.filter(x=>x.ok).length,storedRunners:runs.reduce((s,x)=>s+(x.runnerCount||0),0),cursor,nextCursor,runs,discoveryErrors:discovery.errors,completion:'This response reports this batch only; storage-audit determines coverage.'};
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'date-specific card ingestion and row-level audit'});
  try{
   if(u.pathname==='/v1/lab/card-ingest')return json(await ingestDay(request,env,ctx));
   if(u.pathname==='/v1/lab/card-ingest-range'){
    const dates=[...new Set((u.searchParams.get('dates')||'').split(','))];
    if(!dates.length||dates.length>3||!dates.every(validDate))throw new Error('1-3 valid dates required');
    const runs=[];for(const date of dates){const next=new URL(u);next.pathname='/v1/lab/card-ingest';next.searchParams.set('date',date);runs.push(await ingestDay(new Request(next),env,ctx));}
    return json({ok:runs.every(x=>x.ok),version:VERSION,stage:'multi-day-all-race-card-ingest',runs});
   }
   if(u.pathname==='/v1/lab/storage-audit'){
    const from=u.searchParams.get('from')||today(),to=u.searchParams.get('to')||from;
    if(!validDate(from)||!validDate(to)||from>to)throw new Error('Valid ordered from/to dates required');
    return json(await storageAudit(env.DB,from,to));
   }
   return app.fetch(request,env,ctx);
  }catch(error){return json({ok:false,version:VERSION,error:String(error)},400);}
 },
 async scheduled(event,env,ctx){
  // One waitUntil owns staging and ingestion in order. Rotate all cards in bounded batches.
  ctx.waitUntil((async()=>{
   const date=today();
   await app.fetch(new Request(`https://keiba-lab.internal/v1/lab/meeting-prep?dates=${date}`),env,ctx);
   const dates=(await env.DB.prepare('SELECT DISTINCT race_date FROM jra_race_program WHERE race_date>=? ORDER BY race_date LIMIT 3').bind(date).all()).results||[];
   const slot=Math.floor(event.scheduledTime/3600000)%3;
   for(const row of dates){try{await ingestDay(new Request(`https://keiba-lab.internal/v1/lab/card-ingest?date=${row.race_date}&cursor=${slot*8}`),env,ctx);}catch(error){console.error('card ingestion failed',row.race_date,String(error));}}
  })());
 }
};
