import app from "./index-v2.7.2.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}
function median(a){if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function spearman(rows){const n=rows.length;if(n<2)return null;const sumD2=rows.reduce((s,r)=>s+Math.pow(Number(r.predictedRank)-Number(r.actualFinish),2),0);return 1-(6*sumD2)/(n*(n*n-1))}

async function ensureTables(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_validation_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    validation_type TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    matched_json TEXT NOT NULL,
    audited_at TEXT NOT NULL,
    UNIQUE(race_key,model_version,track_condition)
  )`).run();
}
async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return {race,runners:rr.results||[]};
}

async function stage3AuditV280(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureTables(env.DB);const {race,runners}=await loadRace(env,date,venue,raceNo);

  const locks=await env.DB.prepare(`SELECT model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at FROM lab_model_locks WHERE race_key=? AND track_condition=? ORDER BY id DESC`).bind(race.race_key,track).all();
  const lock=(locks.results||[])[0];
  if(!lock)return{ok:false,stage:"full-boost-3-validation-audit",version:"2.8.0",step:3,raceKey:race.race_key,error:"model lock missing; run step=1 first"};

  const or=await env.DB.prepare(`SELECT horse_no,horse_name,finish_position,source_kind,source_url,fetched_at FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL ORDER BY finish_position`).bind(race.race_key).all();
  const outcomes=or.results||[];
  if(outcomes.length!==runners.length)return{ok:false,stage:"full-boost-3-validation-audit",version:"2.8.0",step:3,raceKey:race.race_key,error:"official outcome coverage is incomplete; rerun step=2",outcomeCount:outcomes.length,runnerCount:runners.length,coveragePct:runners.length?round1(outcomes.length/runners.length*100):0};

  const snap=JSON.parse(lock.snapshot_json||"{}");
  const preds=(snap.runners||[]).filter(x=>Number.isFinite(Number(x.rank))).slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
  if(!preds.length)return{ok:false,stage:"full-boost-3-validation-audit",version:"2.8.0",step:3,raceKey:race.race_key,error:"locked snapshot has no ranked runners"};

  const actualByNo=new Map(outcomes.map(x=>[Number(x.horse_no),Number(x.finish_position)]));
  const matched=preds.filter(p=>actualByNo.has(Number(p.horseNo))).map(p=>({horseNo:Number(p.horseNo),horseName:p.horseName,predictedRank:Number(p.rank),predictedScore:Number(p.score),actualFinish:actualByNo.get(Number(p.horseNo)),absoluteRankError:Math.abs(Number(p.rank)-actualByNo.get(Number(p.horseNo))),signedRankError:Number(p.rank)-actualByNo.get(Number(p.horseNo)),workoutVerified:Boolean(p.workoutVerified),paceStyleImputed:Boolean(p.paceStyleImputed)}));
  const actualWinner=outcomes.find(x=>Number(x.finish_position)===1)||null,predictedWinner=preds[0]||null;
  const winnerModelRank=actualWinner?preds.findIndex(x=>Number(x.horseNo)===Number(actualWinner.horse_no))+1:null;
  const predictedWinnerFinish=predictedWinner?actualByNo.get(Number(predictedWinner.horseNo))??null:null;
  const topN=n=>{const a=new Set(outcomes.filter(x=>Number(x.finish_position)<=n).map(x=>Number(x.horse_no)));const p=preds.slice(0,n);const hit=p.filter(x=>a.has(Number(x.horseNo))).length;return{overlap:hit,recallPct:round1(hit/n*100)}};
  const t3=topN(3),t5=topN(5);
  const absErrors=matched.map(x=>x.absoluteRankError),winnerHit=winnerModelRank===1;
  const metrics={
    actualWinner:actualWinner?{horseNo:Number(actualWinner.horse_no),horseName:actualWinner.horse_name,modelRank:winnerModelRank}:null,
    modelTopPick:predictedWinner?{horseNo:Number(predictedWinner.horseNo),horseName:predictedWinner.horseName,score:Number(predictedWinner.score),actualFinish:predictedWinnerFinish}:null,
    winnerHit,winnerInModelTop3:winnerModelRank!=null&&winnerModelRank<=3,winnerInModelTop5:winnerModelRank!=null&&winnerModelRank<=5,
    top3Overlap:t3.overlap,top3RecallPct:t3.recallPct,top5Overlap:t5.overlap,top5RecallPct:t5.recallPct,
    meanAbsoluteRankError:mean(absErrors)==null?null:round1(mean(absErrors)),medianAbsoluteRankError:median(absErrors)==null?null:round1(median(absErrors)),spearmanRankCorrelation:spearman(matched)==null?null:round1(spearman(matched)),
    exactRankHits:matched.filter(x=>x.absoluteRankError===0).length,within2RankHits:matched.filter(x=>x.absoluteRankError<=2).length,within3RankHits:matched.filter(x=>x.absoluteRankError<=3).length
  };
  const biggestMisses=[...matched].sort((a,b)=>b.absoluteRankError-a.absoluteRankError||a.predictedRank-b.predictedRank).slice(0,5);
  const validationType=lock.seal_kind==="pre-result-candidate"?"prospective-holdout":"post-race-reconstruction-audit";
  const auditedAt=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO lab_validation_audits (race_key,model_version,track_condition,validation_type,metrics_json,matched_json,audited_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,model_version,track_condition) DO UPDATE SET validation_type=excluded.validation_type,metrics_json=excluded.metrics_json,matched_json=excluded.matched_json,audited_at=excluded.audited_at`).bind(race.race_key,lock.model_version,track,validationType,JSON.stringify(metrics),JSON.stringify(matched),auditedAt).run();
  return{ok:true,stage:"full-boost-3-validation-audit",version:"2.8.0",step:3,race:{raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,trackCondition:track},lock:{modelVersion:lock.model_version,sealKind:lock.seal_kind,sealedAt:lock.sealed_at},outcomes:{count:outcomes.length,coveragePct:100,officialSourceKinds:[...new Set(outcomes.map(x=>x.source_kind))]},validationType,metrics,biggestMisses,matched,weights:JSON.parse(lock.weights_json||"{}"),guardrails:{resultLeakage:"Step 3 reads only the sealed Step 1 snapshot for predictions and Step 2 official outcomes for labels.",weightTuningOnThisRace:false,finalPredictionEligible:validationType==="prospective-holdout"},promotionPolicy:"Do not change model weights from this single race. Aggregate multiple prospectively sealed holdout races before promotion.",persisted:true,auditedAt,next:"Aggregate validation audits across multiple prospectively locked races; diagnose recurring miss patterns by pace/style, course/distance, ground and workout evidence."};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.8.0",phase:"full boost step 3 validation audit"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===3)||u.pathname==="/v1/lab/validation-audit")return json(await stage3AuditV280(request,env));
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"2.8.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
