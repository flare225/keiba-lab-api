import app from "./index-v3.1.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d};
}

async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}

async function ensureTables(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_model_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    seal_kind TEXT NOT NULL,
    weights_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    sealed_at TEXT NOT NULL,
    UNIQUE(race_key,model_version,track_condition)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_reconstruction_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    track_condition TEXT NOT NULL,
    original_model_version TEXT NOT NULL,
    repaired_model_version TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(race_key,track_condition,repaired_model_version)
  )`).run();
}

function metricSet(preds,outcomes){
  const actualByNo=new Map(outcomes.map(x=>[Number(x.horse_no),Number(x.finish_position)]));
  const actualWinner=outcomes.find(x=>Number(x.finish_position)===1)||null;
  const topPick=preds[0]||null;
  const winnerRank=actualWinner?preds.findIndex(x=>Number(x.horseNo)===Number(actualWinner.horse_no))+1:null;
  const topPickFinish=topPick?actualByNo.get(Number(topPick.horseNo))??null:null;
  const matched=preds.filter(p=>actualByNo.has(Number(p.horseNo))).map(p=>({horseNo:Number(p.horseNo),horseName:p.horseName,predictedRank:Number(p.rank),score:Number(p.score),actualFinish:actualByNo.get(Number(p.horseNo)),absoluteRankError:Math.abs(Number(p.rank)-actualByNo.get(Number(p.horseNo)))}));
  const mae=mean(matched.map(x=>x.absoluteRankError));
  const topN=n=>{const a=new Set(outcomes.filter(x=>Number(x.finish_position)<=n).map(x=>Number(x.horse_no)));const p=preds.slice(0,n);const hit=p.filter(x=>a.has(Number(x.horseNo))).length;return{overlap:hit,recallPct:round1(hit/n*100)}};
  const t3=topN(3),t5=topN(5);
  return{
    actualWinner:actualWinner?{horseNo:Number(actualWinner.horse_no),horseName:actualWinner.horse_name}:null,
    modelTopPick:topPick?{horseNo:Number(topPick.horseNo),horseName:topPick.horseName,score:Number(topPick.score),actualFinish:topPickFinish}:null,
    actualWinnerModelRank:winnerRank,
    winnerHit:winnerRank===1,
    winnerInTop3:winnerRank!=null&&winnerRank<=3,
    winnerInTop5:winnerRank!=null&&winnerRank<=5,
    top3Overlap:t3.overlap,top3RecallPct:t3.recallPct,
    top5Overlap:t5.overlap,top5RecallPct:t5.recallPct,
    meanAbsoluteRankError:mae==null?null:round1(mae),
    matchedCount:matched.length
  };
}

async function step6RepairedLock(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureTables(env.DB);
  const {race,runners}=await loadRace(env,date,venue,raceNo);

  const overlay=await invoke(u.origin,"/v1/lab/workout-overlay",{date,venue,race_no:raceNo,track},env,ctx);
  if(overlay.status>=400||overlay.data?.ok===false)throw new Error(`workout overlay failed: ${overlay.data?.error||overlay.status}`);
  const repairedPreds=(overlay.data?.runners||[]).map(r=>({
    horseNo:Number(r.horseNo),horseName:r.horseName,rank:Number(r.rank),score:Number(r.confidenceAware100Points),
    workoutVerified:Boolean(r.workoutEvidence?.verified),paceStyleImputed:Boolean(r.evidenceFlags?.paceStyleImputed),
    components:r.baseComponents||null,conditionPrepProxyScore:r.conditionPrepProxyScore??null
  })).sort((a,b)=>a.rank-b.rank);
  if(repairedPreds.length!==runners.length)throw new Error(`repaired prediction coverage incomplete: ${repairedPreds.length}/${runners.length}`);

  const oldLock=await env.DB.prepare(`SELECT model_version,seal_kind,weights_json,snapshot_json,sealed_at FROM lab_model_locks WHERE race_key=? AND model_version='2.7.0' AND track_condition=?`).bind(race.race_key,track).first();
  if(!oldLock)throw new Error("original 2.7.0 lock missing; run step=1 first");
  const oldSnap=JSON.parse(oldLock.snapshot_json||"{}");
  const oldPreds=(oldSnap.runners||[]).map(r=>({horseNo:Number(r.horseNo),horseName:r.horseName,rank:Number(r.rank),score:Number(r.score)})).sort((a,b)=>a.rank-b.rank);

  const or=await env.DB.prepare(`SELECT horse_no,horse_name,finish_position FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL ORDER BY finish_position`).bind(race.race_key).all();
  const outcomes=or.results||[];
  if(outcomes.length!==runners.length)throw new Error(`official outcome coverage incomplete: ${outcomes.length}/${runners.length}`);

  const weights={basicAbilityResults:25,recentPerformanceDevelopment:20,paceStyleFit:20,courseDistanceFit:15,ground:10,conditionPrep:10};
  const sealedAt=new Date().toISOString();
  const repairedSnapshot={
    race:overlay.data?.race,
    source:"repaired-history-parser-reconstruction",
    runners:repairedPreds,
    top5:repairedPreds.slice(0,5)
  };
  await env.DB.prepare(`INSERT INTO lab_model_locks (race_key,model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,model_version,track_condition) DO UPDATE SET seal_kind=excluded.seal_kind,weights_json=excluded.weights_json,snapshot_json=excluded.snapshot_json,sealed_at=excluded.sealed_at`).bind(race.race_key,"3.2.0-repaired",track,"post-race-repaired-reconstruction",JSON.stringify(weights),JSON.stringify(repairedSnapshot),sealedAt).run();

  const originalMetrics=metricSet(oldPreds,outcomes);
  const repairedMetrics=metricSet(repairedPreds,outcomes);
  const rankChanges=repairedPreds.map(r=>{const old=oldPreds.find(x=>x.horseNo===r.horseNo);return{horseNo:r.horseNo,horseName:r.horseName,oldRank:old?.rank??null,newRank:r.rank,rankShift:old?old.rank-r.rank:null,oldScore:old?.score??null,newScore:r.score}}).sort((a,b)=>Math.abs(b.rankShift||0)-Math.abs(a.rankShift||0));
  const comparison={
    original:originalMetrics,
    repaired:repairedMetrics,
    deltas:{
      winnerModelRankDelta:(originalMetrics.actualWinnerModelRank!=null&&repairedMetrics.actualWinnerModelRank!=null)?originalMetrics.actualWinnerModelRank-repairedMetrics.actualWinnerModelRank:null,
      top3RecallPctDelta:round1((repairedMetrics.top3RecallPct||0)-(originalMetrics.top3RecallPct||0)),
      top5RecallPctDelta:round1((repairedMetrics.top5RecallPct||0)-(originalMetrics.top5RecallPct||0)),
      meanAbsoluteRankErrorDelta:(originalMetrics.meanAbsoluteRankError!=null&&repairedMetrics.meanAbsoluteRankError!=null)?round1(repairedMetrics.meanAbsoluteRankError-originalMetrics.meanAbsoluteRankError):null
    },
    biggestRankChanges:rankChanges.slice(0,8)
  };
  await env.DB.prepare(`INSERT INTO lab_reconstruction_comparisons (race_key,track_condition,original_model_version,repaired_model_version,metrics_json,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(race_key,track_condition,repaired_model_version) DO UPDATE SET metrics_json=excluded.metrics_json,created_at=excluded.created_at`).bind(race.race_key,track,"2.7.0","3.2.0-repaired",JSON.stringify(comparison),sealedAt).run();

  return{
    ok:true,
    stage:"full-boost-6-repaired-lock-comparison",
    version:"3.2.0",
    step:6,
    race:{raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,trackCondition:track},
    repairedLock:{modelVersion:"3.2.0-repaired",sealKind:"post-race-repaired-reconstruction",sealedAt,persisted:true},
    originalLock:{modelVersion:oldLock.model_version,sealKind:oldLock.seal_kind,sealedAt:oldLock.sealed_at,untouched:true},
    comparison,
    guardrails:{
      targetRaceResultUsedToBuildRepairedFeatures:false,
      officialOutcomeUsedOnlyForComparison:true,
      originalLockOverwritten:false,
      weightMutation:false,
      prospectiveValidationCredit:false
    },
    interpretation:"This is a post-race reconstruction comparison. It can diagnose data-pipeline defects, but it must not be counted as prospective model validation or used alone to tune weights.",
    next:"Apply the repaired pipeline to a future race before results are known, seal the prediction, then accumulate multiple prospective holdout races before changing weights."
  };
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.2.0",phase:"repaired reconstruction lock comparison"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===6)||u.pathname==="/v1/lab/repaired-compare")return json(await step6RepairedLock(request,env,ctx));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.2.0",build:"repaired-lock-comparison",now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.2.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
