import app from './index-v3.9.1.js';
export const VERSION='3.10.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
async function rows(db,q,a=[]){try{return((await db.prepare(q).bind(...a).all()).results||[])}catch(e){throw new Error(`history query failed: ${e?.message||e}`)}}
async function one(db,q,a=[]){try{return await db.prepare(q).bind(...a).first()}catch(e){throw new Error(`history query failed: ${e?.message||e}`)}}

async function historyDates(db,limit){
 const n=Math.max(1,Math.min(30,Number(limit)||12));
 const x=await rows(db,`SELECT r.race_date date,COUNT(DISTINCT r.race_key) races,SUM(r.runner_count) runners,COUNT(d.id) result_rows,COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN d.race_key END) races_with_results FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key GROUP BY r.race_date ORDER BY r.race_date DESC LIMIT ?`,[n]);
 return x.map(v=>({date:v.date,races:Number(v.races||0),runners:Number(v.runners||0),resultRows:Number(v.result_rows||0),racesWithResults:Number(v.races_with_results||0),resultComplete:Number(v.result_rows||0)===Number(v.runners||0)}));
}
async function historyRaces(db,date){
 const x=await rows(db,`SELECT r.race_key,r.race_date,r.venue,r.race_no,r.race_name,r.runner_count,COUNT(d.id) result_rows,COUNT(DISTINCT d.horse_no) result_distinct FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key WHERE r.race_date=? GROUP BY r.race_key ORDER BY r.venue,r.race_no`,[date]);
 return x.map(v=>({raceKey:v.race_key,date:v.race_date,venue:v.venue,raceNo:Number(v.race_no),raceName:v.race_name,runnerCount:Number(v.runner_count||0),resultRows:Number(v.result_rows||0),resultComplete:Number(v.runner_count||0)>0&&Number(v.result_rows||0)===Number(v.runner_count||0)&&Number(v.result_distinct||0)===Number(v.runner_count||0)}));
}
async function historyRace(db,{date,venue,raceNo}){
 const race=await one(db,'SELECT race_key,race_date,venue,race_no,race_name,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[date,venue,raceNo]);
 if(!race)return null;
 const runners=await rows(db,`SELECT r.horse_no,r.frame_no,r.horse_name,r.sex,r.age,r.assigned_weight,r.jockey,r.trainer,d.finish_position,d.finish_status,d.time_text,d.time_seconds,d.margin,d.corner_positions,d.last3f,d.popularity,d.odds,d.body_weight,d.body_weight_change,d.source_sha256,d.fetched_at FROM jra_runners r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key AND d.horse_no=r.horse_no WHERE r.race_key=? ORDER BY CASE WHEN d.finish_position IS NULL THEN 999 ELSE d.finish_position END,r.horse_no`,[race.race_key]);
 let locks=[];try{locks=await rows(db,`SELECT phase,revision_no,track_condition,audit_json,created_at FROM lab_user_mark_revisions WHERE race_key=? ORDER BY created_at`,[race.race_key])}catch{}
 const marks=locks.map(x=>{let audit=null;try{audit=JSON.parse(x.audit_json)}catch{}return{phase:x.phase,revisionNo:Number(x.revision_no),trackCondition:x.track_condition,createdAt:x.created_at,scoreMutation:false,marked:(audit?.audit?.marked||[]).map(m=>({horseNo:m.horseNo,horseName:m.horseName,mark:m.mark,laboRank:m.laboRank??null,laboScore:m.laboScore??null,alignment:m.alignment??null}))}});
 const resultRows=runners.filter(x=>x.finish_status||x.finish_position!=null).length;
 return{race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:Number(race.race_no),raceName:race.race_name,runnerCount:Number(race.runner_count||0)},result:{rows:resultRows,complete:resultRows===Number(race.runner_count||0)},runners:runners.map(x=>({horseNo:Number(x.horse_no),frameNo:Number(x.frame_no),horseName:x.horse_name,sex:x.sex,age:x.age==null?null:Number(x.age),assignedWeight:x.assigned_weight==null?null:Number(x.assigned_weight),jockey:x.jockey,trainer:x.trainer,finishPosition:x.finish_position==null?null:Number(x.finish_position),finishStatus:x.finish_status||null,time:x.time_text||null,timeSeconds:x.time_seconds==null?null:Number(x.time_seconds),margin:x.margin||null,cornerPositions:x.corner_positions||null,last3f:x.last3f==null?null:Number(x.last3f),popularity:x.popularity==null?null:Number(x.popularity),odds:x.odds==null?null:Number(x.odds),bodyWeight:x.body_weight==null?null:Number(x.body_weight),bodyWeightChange:x.body_weight_change==null?null:Number(x.body_weight_change),sourceSha256:x.source_sha256||null,fetchedAt:x.fetched_at||null})),markRevisions:marks,guardrails:{readOnly:true,officialStoredCard:true,resultSource:'verified JRA official result detail when present',prospectiveDataNeverRecomputedFromResults:true}};
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'history browser'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'read-only-history-browser',now:new Date().toISOString()});
  if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
  try{
   if(u.pathname==='/v1/lab/history/dates'&&request.method==='GET')return json({ok:true,version:VERSION,dates:await historyDates(env.DB,u.searchParams.get('limit'))});
   if(u.pathname==='/v1/lab/history/races'&&request.method==='GET'){const date=u.searchParams.get('date');if(!validDate(date))return json({ok:false,version:VERSION,error:'date=YYYY-MM-DD required'},400);return json({ok:true,version:VERSION,date,races:await historyRaces(env.DB,date)});}
   if(u.pathname==='/v1/lab/history/race'&&request.method==='GET'){const date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')||u.searchParams.get('raceNo'));if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return json({ok:false,version:VERSION,error:'date, venue, race_no=1-12 required'},400);const data=await historyRace(env.DB,{date,venue,raceNo});return data?json({ok:true,version:VERSION,...data}):json({ok:false,version:VERSION,error:'race not found'},404);}
   const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
  }catch(e){return json({ok:false,version:VERSION,error:String(e?.message||e)},500)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
