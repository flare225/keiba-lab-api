import app from './index-v3.8.10.js';
import {parseOfficialResultDetails,persistVerifiedResultDetails,ensureResultDetailTables} from './result-detail-v3.9.0.js';

export const VERSION='3.9.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')}
function jstParts(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const o=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return{date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour)}}
async function rows(db,sql,args=[]){try{return((await db.prepare(sql).bind(...args).all()).results||[])}catch{return[]}}
async function one(db,sql,args=[]){try{return await db.prepare(sql).bind(...args).first()}catch{return null}}
async function fetchHtml(url){const r=await fetch(url,{headers:{'user-agent':'keiba-lab/3.9.0 (+verified rich official result learning)','accept':'text/html,*/*;q=0.8'},redirect:'follow'});const b=await r.arrayBuffer();let body;try{body=new TextDecoder('shift_jis').decode(b)}catch{body=new TextDecoder('utf-8').decode(b)}return{ok:r.ok,status:r.status,url:r.url,body}}
async function raceAndRunners(db,date,venue,raceNo){const race=await one(db,'SELECT race_key,race_date,venue,race_no,race_name,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[date,venue,raceNo]);if(!race)throw new Error('race not found in D1');const runners=await rows(db,'SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no',[race.race_key]);if(runners.length!==Number(race.runner_count||0))throw new Error(`stored card incomplete: ${runners.length}/${race.runner_count}`);return{race,runners}}
async function legacyOutcomeIngest(request,env,ctx,date,venue,raceNo){const u=new URL(request.url);u.pathname='/v1/lab/result-ingest';u.search='';u.searchParams.set('date',date);u.searchParams.set('venue',venue);u.searchParams.set('race_no',String(raceNo));const r=await app.fetch(new Request(u.href,{method:'GET'}),env,ctx);let data=null;try{data=await r.json()}catch{}return{status:r.status,data}}

async function enrichRace(request,env,ctx,{date,venue,raceNo}){
 const {race,runners}=await raceAndRunners(env.DB,date,venue,raceNo);
 await ensureResultDetailTables(env.DB);
 const existing=await one(env.DB,'SELECT COUNT(*) n,COUNT(DISTINCT horse_no) distinct_n,MAX(source_sha256) source_sha256 FROM lab_race_result_details WHERE race_key=?',[race.race_key]);
 if(Number(existing?.n||0)===runners.length&&Number(existing?.distinct_n||0)===runners.length)return{ok:true,idempotent:true,raceKey:race.race_key,storedRows:runners.length,runnerCount:runners.length,complete:true,sourceSha256:existing?.source_sha256||null};
 const legacy=await legacyOutcomeIngest(request,env,ctx,date,venue,raceNo);
 const source=await one(env.DB,"SELECT source_url,COUNT(*) n FROM lab_race_outcomes WHERE race_key=? AND source_url IS NOT NULL GROUP BY source_url ORDER BY n DESC LIMIT 1",[race.race_key]);
 if(!source?.source_url)return{ok:false,raceKey:race.race_key,runnerCount:runners.length,complete:false,error:'official JRA result page has not been resolved yet',legacy};
 const page=await fetchHtml(source.source_url);if(!page.ok)return{ok:false,raceKey:race.race_key,runnerCount:runners.length,complete:false,error:`official result page HTTP ${page.status}`};
 const parsed=parseOfficialResultDetails(page.body,runners);
 if(!parsed.ok)return{ok:false,raceKey:race.race_key,runnerCount:runners.length,complete:false,error:'official result identity verification failed; nothing persisted',identity:parsed.identity,headers:parsed.headers,legacy};
 const saved=await persistVerifiedResultDetails(env.DB,{raceKey:race.race_key,runners,sourceUrl:page.url,sourceHtml:page.body,parsed,fetchedAt:new Date().toISOString()});
 return{ok:true,stage:'verified-rich-result-ingest',version:VERSION,raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,storedRows:saved.storedRows,complete:saved.storedRows===runners.length,revisionId:saved.revisionId,sourceSha256:saved.sourceSha256,identity:parsed.identity,fields:['finish','time','margin','cornerPositions','last3f','popularity','odds','bodyWeight','jockey','assignedWeight'],guardrails:{officialJraSource:true,runnerIdentityVerified:true,atomicPersistence:true,immutableSourceRevision:true,modelLockMutation:false,weightMutation:false}};
}

async function learningStatus(env,date){
 const races=await rows(env.DB,`SELECT r.race_key,r.venue,r.race_no,r.race_name,r.runner_count,COUNT(d.id) detail_rows,COUNT(DISTINCT d.horse_no) detail_distinct FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key WHERE r.race_date=? GROUP BY r.race_key ORDER BY r.venue,r.race_no`,[date]);
 const normalized=races.map(r=>({...r,runner_count:Number(r.runner_count||0),detail_rows:Number(r.detail_rows||0),detail_distinct:Number(r.detail_distinct||0),complete:Number(r.runner_count||0)>0&&Number(r.detail_rows||0)===Number(r.runner_count||0)&&Number(r.detail_distinct||0)===Number(r.runner_count||0)}));
 const complete=normalized.filter(r=>r.complete).length,totalRunners=normalized.reduce((s,r)=>s+r.runner_count,0),stored=normalized.reduce((s,r)=>s+r.detail_rows,0);
 return{ok:true,version:VERSION,date,races:normalized.length,completeRaces:complete,incompleteRaces:normalized.length-complete,runnerRows:{expected:totalRunners,stored,coveragePct:totalRunners?Math.round(stored/totalRunners*1000)/10:0},learningReady:normalized.length>0&&complete===normalized.length,details:normalized};
}

async function dayBatch(request,env,ctx,date,limit=4){
 await ensureResultDetailTables(env.DB);
 const candidates=await rows(env.DB,`SELECT r.venue,r.race_no,r.race_key,r.runner_count,COUNT(d.id) detail_rows FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key WHERE r.race_date=? GROUP BY r.race_key HAVING COUNT(d.id)<r.runner_count ORDER BY r.venue,r.race_no LIMIT ?`,[date,Math.max(1,Math.min(12,Number(limit)||4))]);
 const processed=[];
 for(const c of candidates){try{processed.push(await enrichRace(request,env,ctx,{date,venue:c.venue,raceNo:Number(c.race_no)}))}catch(e){processed.push({ok:false,raceKey:c.race_key,error:String(e?.message||e)})}}
 return{ok:true,version:VERSION,stage:'result-day-enrich-batch',date,attempted:processed.length,succeeded:processed.filter(x=>x.ok).length,processed,status:await learningStatus(env,date)};
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'verified rich results + learning readiness'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'verified-rich-results-learning-readiness',now:new Date().toISOString()});
  if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
  try{
   if(u.pathname==='/v1/lab/result-learning-status'&&request.method==='GET'){const date=u.searchParams.get('date');if(!validDate(date))return json({ok:false,error:'date=YYYY-MM-DD required',version:VERSION},400);await ensureResultDetailTables(env.DB);return json(await learningStatus(env,date));}
   if(u.pathname==='/v1/lab/result-enrich'&&request.method==='POST'){const body=await request.clone().json().catch(()=>({}));const date=body.date||u.searchParams.get('date'),venue=body.venue||u.searchParams.get('venue'),raceNo=Number(body.raceNo||body.race_no||u.searchParams.get('race_no'));if((body.confirm||u.searchParams.get('confirm'))!=='INGEST')return json({ok:false,version:VERSION,error:'confirm=INGEST required'},409);if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return json({ok:false,version:VERSION,error:'date, venue and raceNo=1-12 required'},400);return json(await enrichRace(request,env,ctx,{date,venue,raceNo}));}
   if(u.pathname==='/v1/lab/result-day-enrich'&&request.method==='POST'){const body=await request.clone().json().catch(()=>({}));const date=body.date||u.searchParams.get('date');if((body.confirm||u.searchParams.get('confirm'))!=='INGEST')return json({ok:false,version:VERSION,error:'confirm=INGEST required'},409);if(!validDate(date))return json({ok:false,version:VERSION,error:'date=YYYY-MM-DD required'},400);return json(await dayBatch(request,env,ctx,date,body.limit||u.searchParams.get('limit')||4));}
   const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
  }catch(e){return json({ok:false,version:VERSION,error:String(e?.message||e)},500)}
 },
 async scheduled(event,env,ctx){
  if(app.scheduled)await app.scheduled(event,env,ctx);
  if(!env.DB)return;
  const now=jstParts();
  if(now.hour>=18&&now.hour<=23){try{const req=new Request('https://scheduled.local/v1/lab/result-day-enrich');await dayBatch(req,env,ctx,now.date,4)}catch(e){console.log('result-day-enrich scheduled error',String(e))}}
 }
};
