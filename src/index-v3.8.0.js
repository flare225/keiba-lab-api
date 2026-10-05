import app from './index-v3.7.2.js';
import {requireLockEvidence} from './card-evidence.js';

export const VERSION='3.8.0';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')}
function todayJst(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}

async function prelockReadiness(request,env){
 const u=new URL(request.url),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')),track=u.searchParams.get('track');
 if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error('date=YYYY-MM-DD, venue and race_no=1-12 are required');
 const blockers=[];
 if(!track)blockers.push('track-assumption-required');
 const program=await env.DB.prepare('SELECT program_key,race_label,grade,start_time FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,raceNo).first();
 if(!program)blockers.push('program-not-staged');
 const race=await env.DB.prepare('SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,fetched_at FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,raceNo).first();
 let runners=[];
 if(!race)blockers.push('official-card-not-stored');
 else{
  runners=(await env.DB.prepare('SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all()).results||[];
  if(!Number(race.runner_count)||runners.length!==Number(race.runner_count))blockers.push('runner-card-incomplete');
  else{
   try{await requireLockEvidence(env.DB,race,runners)}catch{blockers.push('official-card-evidence-not-current')}
  }
 }
 const raceKey=race?.race_key||`${date}:${venue}:${raceNo}`;
 const outcome=await env.DB.prepare('SELECT COUNT(*) AS c FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL').bind(raceKey).first();
 if(Number(outcome?.c||0)>0)blockers.push('official-outcomes-already-exist');
 const lock=await env.DB.prepare("SELECT COUNT(*) AS c FROM lab_model_locks WHERE race_key=? AND model_version='3.3.0-prospective'").bind(raceKey).first();
 if(Number(lock?.c||0)>0)blockers.push('already-sealed');
 const today=todayJst();
 if(date<=today)blockers.push(date===today?'same-day-not-strict-holdout':'not-future');
 return{ok:true,version:VERSION,stage:'prelock-readiness',checkedAt:new Date().toISOString(),target:{date,venue,raceNo,trackAssumption:track||null,raceKey},program:program||null,card:{stored:Boolean(race),runnerCount:Number(race?.runner_count||0),storedRunners:runners.length,complete:Boolean(race)&&Number(race.runner_count)>0&&runners.length===Number(race.runner_count)},strictFutureHoldout:date>today,blockers:[...new Set(blockers)],readyToSeal:blockers.length===0,next:blockers.length?'Resolve every blocker before Step 7 prospective seal.':'Run /v1/lab/prospective-seal with the same explicit track assumption.'};
}

function missingTrackOnSeal(u){return (u.pathname==='/v1/lab/prospective-seal'||(u.pathname==='/v1/lab/full-boost'&&Number(u.searchParams.get('step')||1)===7))&&!u.searchParams.get('track')}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'prepublication readiness and explicit prelock assumptions'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'prelock-readiness-explicit-track',now:new Date().toISOString()});
  try{
   if(u.pathname==='/v1/lab/prelock-readiness')return json(await prelockReadiness(request,env));
   if(missingTrackOnSeal(u))return json({ok:false,version:VERSION,error:'track is required for prospective sealing; record the explicit pre-race track assumption instead of defaulting to 良'},400);
   return app.fetch(request,env,ctx);
  }catch(error){return json({ok:false,version:VERSION,error:String(error)},400)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
