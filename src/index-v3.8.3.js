import app from './index-v3.8.2.js';

export const VERSION='3.8.3';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*'}});
const round1=v=>Math.round(Number(v||0)*10)/10;
const mean=a=>a.length?a.reduce((s,x)=>s+Number(x||0),0)/a.length:null;
const pct=(n,d)=>d?round1(n/d*100):0;

async function sha256Hex(text){
 const bytes=new TextEncoder().encode(String(text||''));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function requiredRows(db,sql,args=[]){
 return((await db.prepare(sql).bind(...args).all()).results||[]);
}
function finite(v){return v!==null&&v!==undefined&&Number.isFinite(Number(v))}
function sampleStatus(n){if(n===0)return'no-data';if(n<5)return'too-small';if(n<20)return'preliminary';if(n<50)return'growing';return'useful-sample'}
function validPredictionRanks(predictions,expected){
 const ranks=predictions.map(p=>Number(p.rank));
 return ranks.length===expected&&ranks.every(Number.isInteger)&&ranks.every(r=>r>=1&&r<=expected)&&new Set(ranks).size===expected;
}

export function summarizeRunnerCohort(rows){
 const matched=(rows||[]).filter(r=>finite(r.predictedRank)&&finite(r.actualFinish));
 const errors=matched.map(r=>Math.abs(Number(r.predictedRank)-Number(r.actualFinish)));
 const conf=matched.map(r=>Number(r.baseEvidenceConfidencePct)).filter(Number.isFinite);
 const hist=matched.map(r=>Number(r.historyRows)).filter(Number.isFinite);
 const predictedTop3=matched.filter(r=>Number(r.predictedRank)<=3);
 const actualTop3=matched.filter(r=>Number(r.actualFinish)<=3);
 const predictedTop3Hits=predictedTop3.filter(r=>Number(r.actualFinish)<=3).length;
 const actualTop3Hits=actualTop3.filter(r=>Number(r.predictedRank)<=3).length;
 return{
  runnerSamples:matched.length,
  sampleStatus:sampleStatus(matched.length),
  meanAbsoluteRankError:errors.length?round1(mean(errors)):null,
  exactRankPct:pct(errors.filter(x=>x===0).length,errors.length),
  within2RanksPct:pct(errors.filter(x=>x<=2).length,errors.length),
  predictedTop3PrecisionPct:pct(predictedTop3Hits,predictedTop3.length),
  actualTop3RecallPct:pct(actualTop3Hits,actualTop3.length),
  averageHistoryRows:hist.length?round1(mean(hist)):null,
  confidenceKnownCount:conf.length,
  averageBaseEvidenceConfidencePct:conf.length?round1(mean(conf)):null
 };
}

function oneRaceMetrics(rows){
 const ordered=[...(rows||[])].sort((a,b)=>Number(a.predictedRank)-Number(b.predictedRank));
 const winner=ordered.find(r=>Number(r.actualFinish)===1)||null;
 const top=ordered[0]||null;
 const topN=Math.min(3,ordered.length);
 const actualTop=new Set(ordered.filter(r=>Number(r.actualFinish)<=topN).map(r=>Number(r.horseNo)));
 const predictedTop=ordered.slice(0,topN);
 const overlap=predictedTop.filter(r=>actualTop.has(Number(r.horseNo))).length;
 const errors=ordered.map(r=>Math.abs(Number(r.predictedRank)-Number(r.actualFinish)));
 return{
  winnerHit:Boolean(winner&&Number(winner.predictedRank)===1),
  winnerInTop3:Boolean(winner&&Number(winner.predictedRank)<=3),
  actualWinnerModelRank:winner?Number(winner.predictedRank):null,
  modelTopPickActualFinish:top?Number(top.actualFinish):null,
  top3RecallPct:pct(overlap,topN),
  meanAbsoluteRankError:errors.length?round1(mean(errors)):null
 };
}

export function summarizeRaceSet(races){
 const valid=(races||[]).filter(r=>r?.metrics);
 const maes=valid.map(r=>r.metrics.meanAbsoluteRankError).filter(Number.isFinite);
 const top3=valid.map(r=>r.metrics.top3RecallPct).filter(Number.isFinite);
 return{
  raceSamples:valid.length,
  sampleStatus:sampleStatus(valid.length),
  winnerHitPct:pct(valid.filter(r=>r.metrics.winnerHit).length,valid.length),
  winnerInTop3Pct:pct(valid.filter(r=>r.metrics.winnerInTop3).length,valid.length),
  averageTop3RecallPct:top3.length?round1(mean(top3)):null,
  averageMeanAbsoluteRankError:maes.length?round1(mean(maes)):null
 };
}

async function strictSeals(db){
 return requiredRows(db,`SELECT l.race_key,l.model_version,l.track_condition,l.seal_kind,l.snapshot_json,l.sealed_at,
   s.snapshot_sha256,s.future_day_lock,s.outcome_count_at_seal
   FROM lab_model_locks l JOIN lab_prospective_seals s
   ON s.race_key=l.race_key AND s.model_version=l.model_version AND s.track_condition=l.track_condition
   WHERE l.model_version='3.3.0-prospective' AND l.seal_kind='prospective-holdout'
   AND s.future_day_lock=1 AND s.outcome_count_at_seal=0 ORDER BY l.sealed_at`);
}
async function fallbackHistoryMap(db,raceKey,raceDate){
 const rows=await requiredRows(db,`SELECT rr.horse_no,COUNT(p.race_date) AS history_rows
   FROM jra_runners rr LEFT JOIN jra_past_performances p
   ON p.horse_name=rr.horse_name AND p.race_date<?
   WHERE rr.race_key=? GROUP BY rr.horse_no ORDER BY rr.horse_no`,[raceDate,raceKey]);
 return new Map(rows.map(x=>[Number(x.horse_no),Number(x.history_rows||0)]));
}
async function ageMap(db,raceKey){
 const rows=await requiredRows(db,'SELECT horse_no,age FROM jra_runners WHERE race_key=? ORDER BY horse_no',[raceKey]);
 return new Map(rows.map(x=>[Number(x.horse_no),x.age==null?null:Number(x.age)]));
}

async function cohortAudit(request,env){
 const u=new URL(request.url),scope=(u.searchParams.get('scope')||'two-year-old').toLowerCase();
 if(!['two-year-old','all'].includes(scope))throw new Error('scope must be two-year-old or all');
 const seals=await strictSeals(env.DB);
 const races=[];const skipped=[];
 for(const seal of seals){
  const actualHash=await sha256Hex(seal.snapshot_json);
  if(actualHash!==String(seal.snapshot_sha256||'').toLowerCase()){skipped.push({raceKey:seal.race_key,reason:'snapshot-hash-mismatch'});continue}
  let snap;try{snap=JSON.parse(seal.snapshot_json||'{}')}catch{skipped.push({raceKey:seal.race_key,reason:'snapshot-json-invalid'});continue}
  const predictions=Array.isArray(snap.runners)?snap.runners:[];
  const raceDate=snap.race?.date||null;
  const expected=Number(snap.race?.runnerCount||predictions.length||0);
  const horseNos=predictions.map(p=>Number(p.horseNo));
  if(!raceDate||!expected||predictions.length!==expected||new Set(horseNos).size!==expected||horseNos.some(n=>!Number.isInteger(n)||n<1)){
   skipped.push({raceKey:seal.race_key,reason:'sealed-runner-coverage-invalid'});continue;
  }
  if(!validPredictionRanks(predictions,expected)){skipped.push({raceKey:seal.race_key,reason:'sealed-prediction-ranks-invalid'});continue}

  if(scope==='two-year-old'){
   const ages=await ageMap(env.DB,seal.race_key);
   const ageComplete=predictions.every(p=>ages.has(Number(p.horseNo))&&Number.isFinite(ages.get(Number(p.horseNo))));
   if(!ageComplete){skipped.push({raceKey:seal.race_key,reason:'age-evidence-incomplete'});continue}
   if(!predictions.every(p=>ages.get(Number(p.horseNo))===2)){skipped.push({raceKey:seal.race_key,reason:'not-all-runners-age-2'});continue}
  }

  const outcomes=await requiredRows(env.DB,'SELECT horse_no,finish_position FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL ORDER BY finish_position',[seal.race_key]);
  const actualBy=new Map(outcomes.map(x=>[Number(x.horse_no),Number(x.finish_position)]));
  const outcomeValues=outcomes.map(x=>Number(x.finish_position));
  if(outcomes.length!==expected||predictions.some(p=>!actualBy.has(Number(p.horseNo)))||outcomeValues.some(x=>!Number.isInteger(x)||x<1||x>expected)){
   skipped.push({raceKey:seal.race_key,reason:'official-outcome-coverage-incomplete'});continue;
  }

  const needsHistory=predictions.some(p=>!finite(p.historyRows));
  const history=needsHistory?await fallbackHistoryMap(env.DB,seal.race_key,raceDate):new Map();
  const rows=predictions.map(p=>({
   horseNo:Number(p.horseNo),horseName:p.horseName,predictedRank:Number(p.rank),actualFinish:actualBy.get(Number(p.horseNo)),
   historyRows:finite(p.historyRows)?Number(p.historyRows):(history.get(Number(p.horseNo))??0),
   baseEvidenceConfidencePct:finite(p.baseEvidenceConfidencePct)?Number(p.baseEvidenceConfidencePct):null,
   score:finite(p.score)?Number(p.score):null
  }));
  races.push({
   raceKey:seal.race_key,raceName:snap.race?.raceName||null,date:raceDate,venue:snap.race?.venue||null,raceNo:snap.race?.raceNo||null,
   trackCondition:seal.track_condition,sealedAt:seal.sealed_at,snapshotSha256:seal.snapshot_sha256,runnerCount:expected,
   metrics:oneRaceMetrics(rows),runners:rows
  });
 }

 const allRows=races.flatMap(r=>r.runners);
 const sparse=allRows.filter(r=>Number(r.historyRows)<=1);
 const twoPlus=allRows.filter(r=>Number(r.historyRows)>=2);
 const confidenceKnown=allRows.filter(r=>finite(r.baseEvidenceConfidencePct));
 const confidenceBands={
  low:summarizeRunnerCohort(confidenceKnown.filter(r=>Number(r.baseEvidenceConfidencePct)<50)),
  medium:summarizeRunnerCohort(confidenceKnown.filter(r=>Number(r.baseEvidenceConfidencePct)>=50&&Number(r.baseEvidenceConfidencePct)<70)),
  high:summarizeRunnerCohort(confidenceKnown.filter(r=>Number(r.baseEvidenceConfidencePct)>=70))
 };
 return{
  ok:true,version:VERSION,stage:'strict-prospective-cohort-audit',scope,
  eligibility:{strictProspectiveSealsFound:seals.length,eligibleCompletedRaces:races.length,skippedCount:skipped.length,skipped},
  raceMetrics:summarizeRaceSet(races),
  evidenceDepthCohorts:{zeroToOneHistory:summarizeRunnerCohort(sparse),twoPlusHistory:summarizeRunnerCohort(twoPlus)},
  confidenceBands,
  races,
  guardrails:{prospectiveFutureDaySealRequired:true,outcomeCountAtSealRequiredZero:true,snapshotSha256Verified:true,targetResultNeverUsedToCreatePrediction:true,automaticWeightMutation:false,reconstructionLocksExcluded:true,requiredValidationTablesFailClosed:true},
  interpretationPolicy:'Compare sparse-history and deeper-history cohorts only after enough strict prospectively sealed races accumulate. Small samples are diagnostic, not a reason to tune weights.',
  promotionPolicy:{automaticWeightChanges:false,minimumRecommendedStrictRaceSampleBeforeModelChangeReview:20,saudiRcMayContributeOnlyAfterItsExistingHashLockedPredictionIsScoredAgainstOfficialOutcomes:true}
 };
}

export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'strict prospective evidence-depth cohort validation'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'strict-prospective-cohort-audit',now:new Date().toISOString()});
  if(u.pathname==='/v1/lab/prospective-cohort-audit'){
   if(!env.DB)return json({ok:false,version:VERSION,error:'D1 binding DB is not configured'},500);
   try{return json(await cohortAudit(request,env))}catch(error){return json({ok:false,version:VERSION,error:String(error)},500)}
  }
  return app.fetch(request,env,ctx);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
