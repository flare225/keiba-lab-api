import app from './index-v3.8.1.js';

export const VERSION='3.8.2';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')}
function finite(v){return v!==null&&v!==undefined&&Number.isFinite(Number(v))}
async function safeRows(db,sql,args=[]){try{return((await db.prepare(sql).bind(...args).all()).results||[])}catch{return[]}}

async function invoke(origin,path,params,env,ctx){
 const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));
 const r=await app.fetch(new Request(u.href,{method:'GET'}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d};
}

export async function coreFeatureAudit(db,date,venue,raceNo,track){
 const race=await db.prepare('SELECT race_key,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,raceNo).first();
 if(!race)return{available:false,ready:false,reason:'official-card-not-stored',runners:[]};
 const runners=await safeRows(db,'SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no',[race.race_key]);
 const base=await safeRows(db,"SELECT horse_no,basic_score,recent_score,model_coverage_pct,confidence_pct FROM lab_prediction_snapshots WHERE race_key=? AND model_version='1.5.0' AND track_condition=? ORDER BY horse_no",[race.race_key,track]);
 const pace=await safeRows(db,"SELECT horse_no,pace_style_fit_score,evidence_confidence FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0' ORDER BY horse_no",[race.race_key]);
 const integrated=await safeRows(db,"SELECT horse_no,prefinal_points FROM lab_integrated_snapshots WHERE race_key=? AND model_version='2.3.0' AND track_condition=? ORDER BY horse_no",[race.race_key,track]);
 const history=await safeRows(db,`SELECT rr.horse_no,COUNT(p.race_date) AS history_rows FROM jra_runners rr LEFT JOIN jra_past_performances p ON p.horse_name=rr.horse_name AND p.race_date<? WHERE rr.race_key=? GROUP BY rr.horse_no ORDER BY rr.horse_no`,[date,race.race_key]);
 const baseBy=new Map(base.map(x=>[Number(x.horse_no),x])),paceBy=new Map(pace.map(x=>[Number(x.horse_no),x])),intBy=new Map(integrated.map(x=>[Number(x.horse_no),x])),histBy=new Map(history.map(x=>[Number(x.horse_no),Number(x.history_rows||0)]));
 const rows=runners.map(r=>{const no=Number(r.horse_no),b=baseBy.get(no),p=paceBy.get(no),i=intBy.get(no),h=histBy.get(no)||0;return{horseNo:no,horseName:r.horse_name,historyRows:h,basicReady:finite(b?.basic_score),recentReady:finite(b?.recent_score),paceReady:finite(p?.pace_style_fit_score),integratedReady:finite(i?.prefinal_points),baseModelCoveragePct:b?.model_coverage_pct==null?null:Number(b.model_coverage_pct),baseConfidencePct:b?.confidence_pct==null?null:Number(b.confidence_pct),paceEvidenceConfidence:p?.evidence_confidence||null};});
 const expected=Number(race.runner_count||0),cardRowsComplete=expected>0&&runners.length===expected;
 const basicReady=rows.filter(x=>x.basicReady).length,recentReady=rows.filter(x=>x.recentReady).length,paceReady=rows.filter(x=>x.paceReady).length,integratedReady=rows.filter(x=>x.integratedReady).length;
 const zeroHistory=rows.filter(x=>x.historyRows===0).length,oneHistory=rows.filter(x=>x.historyRows===1).length;
 const ready=cardRowsComplete&&basicReady===expected&&recentReady===expected&&paceReady===expected&&integratedReady===expected;
 const warnings=[];if(zeroHistory)warnings.push('some-runners-have-zero-pre-race-history');if(oneHistory)warnings.push('some-runners-have-only-one-pre-race-history-row');
 return{available:true,ready,raceKey:race.race_key,runnerCount:expected,cardRowsComplete,coverage:{basicAbility:{count:basicReady,pct:expected?Math.round(basicReady/expected*1000)/10:0},recentPerformance:{count:recentReady,pct:expected?Math.round(recentReady/expected*1000)/10:0},paceStyle:{count:paceReady,pct:expected?Math.round(paceReady/expected*1000)/10:0},integrated:{count:integratedReady,pct:expected?Math.round(integratedReady/expected*1000)/10:0}},history:{zeroHistoryCount:zeroHistory,oneHistoryCount:oneHistory,twoPlusHistoryCount:rows.filter(x=>x.historyRows>=2).length},warnings,runners:rows};
}

async function prelockBuild(request,env,ctx){
 const u=new URL(request.url),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')),track=u.searchParams.get('track');
 if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12||!track)throw new Error('date=YYYY-MM-DD, venue, race_no=1-12 and explicit track are required');
 const common={date,venue,race_no:raceNo};
 const calls=[
  ['history','/v1/lab/history-ingest',{...common,limit:5}],
  ['trackBias','/v1/lab/track-bias',{...common,persist:1}],
  ['baseRank','/v1/lab/rank',{...common,track,persist:1}],
  ['paceStyle','/v1/lab/pace-style',{...common,persist:1}],
  ['paceNeutralFill','/v1/lab/pace-fill-neutral',{...common,track}],
  ['provisional100','/v1/lab/provisional-100',{...common,track}],
  ['workoutOverlay','/v1/lab/workout-overlay',{...common,track}],
 ];
 const stages={};
 for(const[name,path,params]of calls){const r=await invoke(u.origin,path,params,env,ctx);stages[name]={httpStatus:r.status,ok:r.status<400&&r.data?.ok!==false,version:r.data?.version||null,stage:r.data?.stage||null,error:r.data?.error||null};}
 const audit=await coreFeatureAudit(env.DB,date,venue,raceNo,track);
 return{ok:audit.ready,version:VERSION,stage:'prelock-feature-build',target:{date,venue,raceNo,trackAssumption:track},stages,coreFeatureAudit:audit,scoreMutation:false,sealWritten:false,next:audit.ready?'Run prelock-readiness, then prospective-seal.':'Inspect failed stages/core coverage; do not seal yet.'};
}

async function enrichedReadiness(request,env,ctx){
 const baseResponse=await app.fetch(request,env,ctx);let base;try{base=await baseResponse.json()}catch{return baseResponse}
 if(!baseResponse.ok||base?.ok===false)return json(base,baseResponse.status);
 const u=new URL(request.url),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')),track=u.searchParams.get('track');
 if(!track||!env.DB)return json({...base,version:VERSION});
 const audit=await coreFeatureAudit(env.DB,date,venue,raceNo,track);
 const blockers=[...(base.blockers||[])];
 if(audit.available&&!audit.ready&&!blockers.includes('core-feature-layer-not-ready'))blockers.push('core-feature-layer-not-ready');
 return json({...base,version:VERSION,coreFeatureAudit:audit,warnings:[...new Set([...(base.warnings||[]),...(audit.warnings||[])])],blockers,readyToSeal:blockers.length===0});
}

async function sealGate(request,env,ctx){
 const u=new URL(request.url),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),raceNo=Number(u.searchParams.get('race_no')),track=u.searchParams.get('track');
 if(!track)return app.fetch(request,env,ctx);
 const race=await env.DB.prepare('SELECT race_key FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,raceNo).first();
 if(race){
  const existing=await env.DB.prepare("SELECT COUNT(*) AS c FROM lab_model_locks WHERE race_key=? AND model_version='3.3.0-prospective' AND track_condition=?").bind(race.race_key,track).first();
  if(Number(existing?.c||0)>0)return app.fetch(request,env,ctx);
 }
 const audit=await coreFeatureAudit(env.DB,date,venue,raceNo,track);
 if(!audit.ready)return json({ok:false,version:VERSION,error:'core pre-race feature coverage is incomplete; run /v1/lab/prelock-build before prospective sealing',coreFeatureAudit:audit},409);
 return app.fetch(request,env,ctx);
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'prelock feature build + evidence-depth holdout'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'prelock-core-coverage-and-evidence-depth',now:new Date().toISOString()});
  try{
   if(u.pathname==='/v1/lab/prelock-build')return json(await prelockBuild(request,env,ctx));
   if(u.pathname==='/v1/lab/prelock-readiness')return enrichedReadiness(request,env,ctx);
   if(u.pathname==='/v1/lab/prospective-seal'||(u.pathname==='/v1/lab/full-boost'&&Number(u.searchParams.get('step')||1)===7))return sealGate(request,env,ctx);
   return app.fetch(request,env,ctx);
  }catch(error){return json({ok:false,version:VERSION,error:String(error)},500)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
