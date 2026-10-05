import app from './index-v3.8.5.js';
import {ensurePrecardTables,seedDefaultPrecardTargets,DEFAULT_PRECARD_TARGETS} from './precard-context-v3.8.5.js';

export const VERSION='3.8.6';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
async function safeRows(db,sql,args=[]){try{return((await db.prepare(sql).bind(...args).all()).results||[])}catch{return[]}}
async function safeFirst(db,sql,args=[]){try{return await db.prepare(sql).bind(...args).first()}catch{return null}}

async function safePrecardStatus(env,raceKey){
  await ensurePrecardTables(env.DB);
  await seedDefaultPrecardTargets(env.DB);
  const target=await safeFirst(env.DB,'SELECT * FROM lab_precard_targets WHERE race_key=?',[raceKey]);
  if(!target)return{ok:false,version:VERSION,error:'precard target not found'};
  const rows=await safeRows(env.DB,'SELECT * FROM lab_precard_runner_context WHERE race_key=? AND active_in_latest=1 ORDER BY horse_name',[raceKey]);
  const evidence=await safeFirst(env.DB,'SELECT * FROM lab_precard_source_evidence WHERE race_key=?',[raceKey]);
  const history=await safeRows(env.DB,`SELECT c.horse_name,COUNT(p.race_date) AS history_rows FROM lab_precard_runner_context c
    LEFT JOIN jra_past_performances p ON p.horse_name=c.horse_name AND p.race_date<?
    WHERE c.race_key=? AND c.active_in_latest=1 GROUP BY c.horse_name ORDER BY c.horse_name`,[target.race_date,raceKey]);
  const histBy=new Map(history.map(x=>[x.horse_name,Number(x.history_rows||0)]));
  const enriched=rows.map(x=>({...x,historyRows:histBy.get(x.horse_name)||0}));
  const race=await safeFirst(env.DB,'SELECT race_key,runner_count,fetched_at FROM jra_races WHERE race_key=?',[raceKey]);
  const official=race?await safeRows(env.DB,'SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no',[raceKey]):[];
  const preSet=new Set(rows.map(x=>x.horse_name)),officialSet=new Set(official.map(x=>x.horse_name));
  const matched=official.filter(x=>preSet.has(x.horse_name)).map(x=>x.horse_name);
  const featuredNotOnCard=rows.filter(x=>!officialSet.has(x.horse_name)).map(x=>x.horse_name);
  const cardNotFeatured=official.filter(x=>!preSet.has(x.horse_name)).map(x=>x.horse_name);
  const count=rows.length;
  const pedigreeReady=rows.filter(x=>x.sire&&x.dam&&x.damsire).length;
  const trainerReady=rows.filter(x=>x.trainer).length;
  const age2=rows.filter(x=>Number(x.age)===2).length;
  const sourceAligned=!evidence||!rows.length||rows.every(x=>x.source_sha256===evidence.source_sha256);
  const warnings=[];
  if(evidence?.published_flag&&!rows.length)warnings.push('published-source-with-zero-active-context-rows');
  if(!sourceAligned)warnings.push('precard-context-source-evidence-mismatch');
  if(rows.some(x=>Number(x.age)!==2))warnings.push('non-two-year-old-context-row');
  if(count&&pedigreeReady<count)warnings.push('precard-pedigree-incomplete');
  if(count&&trainerReady<count)warnings.push('precard-trainer-incomplete');
  if(enriched.some(x=>x.historyRows===0))warnings.push('zero-history-two-year-old-present');
  if(enriched.some(x=>x.historyRows===1))warnings.push('one-history-two-year-old-present');
  return{
    ok:true,version:VERSION,stage:'precard-context-audit-bootstrap-safe',raceKey,
    target:{date:target.race_date,venue:target.venue,raceNo:Number(target.race_no),raceName:target.race_name,sourceUrl:target.source_url,status:target.last_status,lastCheckedAt:target.last_checked_at,lastSuccessAt:target.last_success_at},
    sourceEvidence:evidence||null,
    dataQuality:{featuredRunnerCount:count,age2Count:age2,pedigreeCompleteCount:pedigreeReady,pedigreeCoveragePct:count?Math.round(pedigreeReady/count*1000)/10:0,trainerCompleteCount:trainerReady,trainerCoveragePct:count?Math.round(trainerReady/count*1000)/10:0,zeroHistoryCount:enriched.filter(x=>x.historyRows===0).length,oneHistoryCount:enriched.filter(x=>x.historyRows===1).length,twoPlusHistoryCount:enriched.filter(x=>x.historyRows>=2).length,sourceEvidenceAligned:sourceAligned},
    officialCardComparison:race?{status:'available',officialRunnerCount:Number(race.runner_count||official.length),storedOfficialRows:official.length,matchedCount:matched.length,matched,featuredNotOnCard,cardNotFeatured}:{status:'official-card-not-yet-stored',matchedCount:0,matched:[],featuredNotOnCard:[],cardNotFeatured:[]},
    warnings,runners:enriched,
    bootstrap:{historyTableOptional:true,officialCardTablesOptional:true,missingOptionalTablesAreTreatedAsNoEvidenceNotFatal:true},
    guardrails:{writesJraRunners:false,writesJraRaces:false,authoritativeForCard:false,eligibleForProspectiveSeal:false,officialNumberedCardStillRequired:true,horseNumbersNeverInferredFromPrecardPage:true}
  };
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'pre-card bootstrap hardening'});
    if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'precard-bootstrap-safe-audit',now:new Date().toISOString()});
    if(u.pathname==='/v1/lab/precard-context-status'){
      if(!env.DB)return json({ok:false,version:VERSION,error:'D1 binding DB is not configured'},500);
      try{return json(await safePrecardStatus(env,u.searchParams.get('race_key')||DEFAULT_PRECARD_TARGETS[0].raceKey))}
      catch(error){return json({ok:false,version:VERSION,error:String(error)},500)}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
