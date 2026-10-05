import app from './index-v3.13.0.js';
import {deriveIngestAudit} from './ingest-audit-v3.14.0.js';
export const VERSION='3.16.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
async function one(db,q,a=[]){try{return await db.prepare(q).bind(...a).first()}catch{return null}}
export async function prelockAudit(env,{date,venue,raceNo}){
 if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return{status:400,data:{ok:false,error:'date, venue, race_no=1-12 required'}};
 const race=await one(env.DB,'SELECT race_key,race_date,venue,race_no,race_name,runner_count,fetched_at FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[date,venue,raceNo]);
 if(!race)return{status:404,data:{ok:false,error:'race not found',gate:'BLOCK'}};
 const agg=await one(env.DB,`SELECT COUNT(*) stored,COUNT(DISTINCT horse_no) distinct_n,SUM(CASE WHEN horse_no<1 OR horse_no>18 OR horse_name IS NULL OR TRIM(horse_name)='' THEN 1 ELSE 0 END) invalid_n,MIN(horse_no) min_no,MAX(horse_no) max_no FROM jra_runners WHERE race_key=?`,[race.race_key]);
 const ev=await one(env.DB,'SELECT card_fetched_at,declared_count,source_row_count,horse_numbers_observed,frames_observed FROM lab_card_source_evidence WHERE race_key=?',[race.race_key]);
 const declared=Number(race.runner_count||0),stored=Number(agg?.stored||0),distinct=Number(agg?.distinct_n||0),duplicateHorseNos=Math.max(0,stored-distinct),invalidHorseNos=Number(agg?.invalid_n||0)?[-1]:[];
 const missingHorseNos=[];if(declared>0){const rows=await env.DB.prepare('SELECT horse_no FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all();const got=new Set((rows.results||[]).map(x=>Number(x.horse_no)));for(let n=1;n<=declared;n++)if(!got.has(n))missingHorseNos.push(n)}
 const sourceVerified=!!ev&&ev.card_fetched_at===race.fetched_at&&Number(ev.declared_count)===declared&&Number(ev.source_row_count)===declared&&!!ev.horse_numbers_observed&&!!ev.frames_observed;
 const audit=deriveIngestAudit({declared,stored,duplicateHorseNos,missingHorseNos,invalidHorseNos,sourceVerified,sourceFetchedAt:ev?.card_fetched_at||null});
 return{status:200,data:{ok:true,version:VERSION,race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:Number(race.race_no),raceName:race.race_name},audit,gate:audit.passed?'ALLOW_PRELOCK':'BLOCK_PRELOCK'}};
}
export default{async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'runtime preLOCK audit'});if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'runtime-prelock-audit',now:new Date().toISOString()});if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);if(u.pathname==='/v1/lab/prelock-audit'&&request.method==='GET'){const r=await prelockAudit(env,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:Number(u.searchParams.get('race_no')||u.searchParams.get('raceNo'))});return json(r.data,r.status)}const r=await app.fetch(request,env,ctx);let d;try{d=await r.clone().json()}catch{return r}if(d&&typeof d==='object')d.version=VERSION;return json(d,r.status)},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}};
