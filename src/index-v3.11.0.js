import app from './index-v3.10.0.js';
import {sha256} from './card-evidence.js';
export const VERSION='3.11.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
async function one(db,q,a=[]){try{return await db.prepare(q).bind(...a).first()}catch{return null}}
export function markForRank(rank){return({1:'◎',2:'○',3:'▲',4:'△',5:'☆'})[Number(rank)]||null}
export function normalizePrediction(snapshot,meta={}){
 const runners=(snapshot?.runners||[]).map(r=>({horseNo:Number(r.horseNo),frameNo:r.frameNo==null?null:Number(r.frameNo),horseName:r.horseName,rank:Number(r.rank),score:r.score==null?null:Number(r.score),mark:markForRank(r.rank),historyRows:r.historyRows??null,workoutVerified:r.workoutVerified??null,components:r.components??null})).sort((a,b)=>a.rank-b.rank);
 return{available:true,locked:true,source:'immutable-prospective-seal',modelVersion:meta.modelVersion||'3.3.0-prospective',trackCondition:meta.trackCondition||snapshot?.race?.trackCondition||null,sealKind:meta.sealKind||snapshot?.sealKind||null,sealedAt:meta.sealedAt||null,snapshotSha256:meta.snapshotSha256||null,hashVerified:meta.hashVerified===true,markPolicy:{version:'rank-v1',rule:'1=◎ / 2=○ / 3=▲ / 4=△ / 5=☆',derivedOnlyFromLockedPreResultRank:true},top5:runners.filter(r=>r.rank<=5),runners,guardrails:{preResultSnapshotOnly:true,resultDataUsed:false,recomputedAfterResult:false,markDoesNotMutateLockedRankOrScore:true}};
}
async function lockedPrediction(db,raceKey,track=null){
 const args=[raceKey];let trackSql='';if(track){trackSql=' AND l.track_condition=?';args.push(track)}
 const row=await one(db,`SELECT l.model_version,l.track_condition,l.seal_kind,l.snapshot_json,l.sealed_at,s.snapshot_sha256 FROM lab_model_locks l LEFT JOIN lab_prospective_seals s ON s.race_key=l.race_key AND s.model_version=l.model_version AND s.track_condition=l.track_condition WHERE l.race_key=? AND l.model_version='3.3.0-prospective'${trackSql} ORDER BY l.sealed_at DESC LIMIT 1`,args);
 if(!row?.snapshot_json)return{available:false,locked:false,reason:'immutable prospective LABO prediction was not sealed before the result; no post-race reconstruction is shown'};
 let snapshot;try{snapshot=JSON.parse(row.snapshot_json)}catch{return{available:false,locked:false,reason:'stored LABO prediction snapshot is unreadable'}}
 const actual=await sha256(row.snapshot_json),hashVerified=Boolean(row.snapshot_sha256&&actual===row.snapshot_sha256);
 if(!hashVerified)return{available:false,locked:false,reason:'stored LABO prediction failed SHA-256 verification'};
 return normalizePrediction(snapshot,{modelVersion:row.model_version,trackCondition:row.track_condition,sealKind:row.seal_kind,sealedAt:row.sealed_at,snapshotSha256:row.snapshot_sha256,hashVerified});
}
async function resolveRace(db,{date,venue,raceNo}){return one(db,'SELECT race_key,race_date,venue,race_no,race_name,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[date,venue,raceNo])}
async function predictionForTarget(db,{date,venue,raceNo,track}){const race=await resolveRace(db,{date,venue,raceNo});if(!race)return null;return{race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:Number(race.race_no),raceName:race.race_name,runnerCount:Number(race.runner_count||0)},prediction:await lockedPrediction(db,race.race_key,track)}}
async function enrichHistoryResponse(response,env){
 let data;try{data=await response.clone().json()}catch{return response}
 if(!response.ok||!data?.race?.raceKey){if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status)}
 data.laboPrediction=await lockedPrediction(env.DB,data.race.raceKey);
 data.guardrails={...(data.guardrails||{}),laboPredictionRequiresImmutablePreResultSeal:true,noPostRaceLABOPredictionReconstruction:true};
 data.version=VERSION;return json(data,response.status);
}
export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'immutable LABO prediction marks + history comparison'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'locked-labo-prediction-marks',now:new Date().toISOString()});
  if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
  try{
   if(u.pathname==='/v1/lab/labo-prediction'&&request.method==='GET'){
    const date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')||u.searchParams.get('raceNo')),track=u.searchParams.get('track')||null;
    if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return json({ok:false,version:VERSION,error:'date, venue, race_no=1-12 required'},400);
    const data=await predictionForTarget(env.DB,{date,venue,raceNo,track});return data?json({ok:true,version:VERSION,...data}):json({ok:false,version:VERSION,error:'race not found'},404);
   }
   if(u.pathname==='/v1/lab/history/race'&&request.method==='GET')return enrichHistoryResponse(await app.fetch(request,env,ctx),env);
   const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
  }catch(e){return json({ok:false,version:VERSION,error:String(e?.message||e)},500)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
