import app from "./index-v2.8.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
const WEIGHTS={basicAbilityResults:25,recentPerformanceDevelopment:20,paceStyleFit:20,courseDistanceFit:15,ground:10,conditionPrep:10};
const BLOCKS=[
  ["basicAbilityResults","basic_score",25],
  ["recentPerformanceDevelopment","recent_score",20],
  ["paceStyleFit","pace_style_score",20],
  ["courseDistanceFit","course_distance_score",15],
  ["ground","ground_score",10],
  ["conditionPrep","condition_prep_score",10],
];

async function ensureDiagnosticTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_error_diagnostics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    diagnostic_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(race_key,model_version,track_condition)
  )`).run();
}
async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name,jockey,trainer,assigned_weight FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}
function weightedPoint(score,weight){const n=Number(score);return Number.isFinite(n)?round1(n*weight/100):null}
function blockView(row){
  return Object.fromEntries(BLOCKS.map(([key,col,w])=>[key,{score:row?.[col]??null,weight:w,points:weightedPoint(row?.[col],w)}]));
}
function blockDiff(a,b){
  return BLOCKS.map(([key,col,w])=>{
    const av=Number(a?.[col]),bv=Number(b?.[col]);
    const valid=Number.isFinite(av)&&Number.isFinite(bv);
    return{block:key,weight:w,topPickScore:valid?av:null,winnerScore:valid?bv:null,rawDeltaTopMinusWinner:valid?round1(av-bv):null,weightedPointDeltaTopMinusWinner:valid?round1((av-bv)*w/100):null};
  }).filter(x=>x.rawDeltaTopMinusWinner!=null);
}

async function step4Diagnostics(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureDiagnosticTable(env.DB);
  const {race,runners}=await loadRace(env,date,venue,raceNo);

  const locks=await env.DB.prepare(`SELECT id,model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at FROM lab_model_locks WHERE race_key=? AND track_condition=? ORDER BY id DESC`).bind(race.race_key,track).all();
  const lock=(locks.results||[])[0];
  if(!lock)return{ok:false,stage:"full-boost-4-error-diagnostics",version:"2.9.0",step:4,error:"model lock missing; run step 1"};

  const or=await env.DB.prepare(`SELECT horse_no,horse_name,finish_position FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL ORDER BY finish_position`).bind(race.race_key).all();
  const outcomes=or.results||[];
  if(outcomes.length!==runners.length)return{ok:false,stage:"full-boost-4-error-diagnostics",version:"2.9.0",step:4,error:"official outcome coverage incomplete; run step 2",outcomeCount:outcomes.length,runnerCount:runners.length};

  const ir=await env.DB.prepare(`SELECT horse_no,horse_name,basic_score,recent_score,pace_style_score,course_distance_score,ground_score,condition_prep_score,prefinal_points,normalized_evidence_score,generated_at FROM lab_integrated_snapshots WHERE race_key=? AND track_condition=? AND model_version='2.3.0' ORDER BY horse_no`).bind(race.race_key,track).all();
  const integratedByNo=new Map((ir.results||[]).map(x=>[Number(x.horse_no),x]));
  const pr=await env.DB.prepare(`SELECT horse_no,style_key,style_label,pace_bias,lane_bias,bias_confidence,evidence_confidence,pace_style_fit_score,source_race_date,source_race_name FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0' ORDER BY horse_no`).bind(race.race_key).all();
  const paceByNo=new Map((pr.results||[]).map(x=>[Number(x.horse_no),x]));
  const cr=await env.DB.prepare(`SELECT horse_no,condition_prep_score,evidence_confidence,signals_available,freshness_bucket,days_since_last_run,current_body_weight,current_body_weight_change,avg_abs_historical_weight_change,evidence_kind FROM lab_condition_prep_snapshots WHERE race_key=? AND model_version='2.3.0' ORDER BY horse_no`).bind(race.race_key).all();
  const conditionByNo=new Map((cr.results||[]).map(x=>[Number(x.horse_no),x]));
  let workoutRows=[];try{const wr=await env.DB.prepare(`SELECT horse_no,score,grade,confidence,source_kind,source_note,verified FROM lab_workout_evidence WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();workoutRows=wr.results||[]}catch{}
  const workoutByNo=new Map(workoutRows.map(x=>[Number(x.horse_no),x]));

  const snap=JSON.parse(lock.snapshot_json||"{}");
  const preds=(snap.runners||[]).slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
  const actualByNo=new Map(outcomes.map(x=>[Number(x.horse_no),Number(x.finish_position)]));
  const actualWinner=outcomes.find(x=>Number(x.finish_position)===1)||null;
  const topPick=preds[0]||null;
  if(!actualWinner||!topPick)return{ok:false,stage:"full-boost-4-error-diagnostics",version:"2.9.0",step:4,error:"winner or top pick unavailable"};

  const winnerNo=Number(actualWinner.horse_no),topNo=Number(topPick.horseNo);
  const topComponents=integratedByNo.get(topNo)||null,winnerComponents=integratedByNo.get(winnerNo)||null;
  const diffs=blockDiff(topComponents,winnerComponents);
  const topPickAdvantages=[...diffs].filter(x=>x.weightedPointDeltaTopMinusWinner>0).sort((a,b)=>b.weightedPointDeltaTopMinusWinner-a.weightedPointDeltaTopMinusWinner);
  const winnerAdvantages=[...diffs].filter(x=>x.weightedPointDeltaTopMinusWinner<0).sort((a,b)=>a.weightedPointDeltaTopMinusWinner-b.weightedPointDeltaTopMinusWinner).map(x=>({...x,winnerWeightedPointAdvantage:round1(-x.weightedPointDeltaTopMinusWinner)}));

  const rows=preds.filter(p=>actualByNo.has(Number(p.horseNo))).map(p=>{
    const no=Number(p.horseNo),comp=integratedByNo.get(no)||null,pace=paceByNo.get(no)||null,cond=conditionByNo.get(no)||null,workout=workoutByNo.get(no)||null,actual=actualByNo.get(no);
    return{horseNo:no,horseName:p.horseName,predictedRank:Number(p.rank),lockedScore:Number(p.score),actualFinish:actual,rankError:Number(p.rank)-actual,absoluteRankError:Math.abs(Number(p.rank)-actual),components:blockView(comp),paceEvidence:pace?{styleKey:pace.style_key,styleLabel:pace.style_label,paceBias:pace.pace_bias,laneBias:pace.lane_bias,biasConfidence:pace.bias_confidence,evidenceConfidence:pace.evidence_confidence,sourceRaceDate:pace.source_race_date,sourceRaceName:pace.source_race_name}:null,conditionEvidence:cond?{score:cond.condition_prep_score,confidence:cond.evidence_confidence,signals:cond.signals_available,freshnessBucket:cond.freshness_bucket,daysSinceLastRun:cond.days_since_last_run,currentBodyWeightChange:cond.current_body_weight_change,evidenceKind:cond.evidence_kind}:null,workoutEvidence:workout?{score:workout.score,grade:workout.grade,confidence:workout.confidence,sourceKind:workout.source_kind,verified:Boolean(workout.verified)}:null,evidenceFlags:{paceStyleImputed:String(pace?.evidence_confidence||"").startsWith("neutral-imputation"),workoutVerified:Boolean(workout?.verified)}};
  });

  const biggestMisses=[...rows].sort((a,b)=>b.absoluteRankError-a.absoluteRankError||a.predictedRank-b.predictedRank).slice(0,5);
  const topRow=rows.find(x=>x.horseNo===topNo),winnerRow=rows.find(x=>x.horseNo===winnerNo);
  const confidenceRisks=[];
  if(topRow?.evidenceFlags?.paceStyleImputed)confidenceRisks.push("model top pick used neutral-imputed pace/style evidence");
  if(!topRow?.evidenceFlags?.workoutVerified)confidenceRisks.push("model top pick had no verified runner-specific workout evidence");
  if(winnerRow?.evidenceFlags?.paceStyleImputed)confidenceRisks.push("actual winner used neutral-imputed pace/style evidence");
  if(!winnerRow?.evidenceFlags?.workoutVerified)confidenceRisks.push("actual winner had no verified runner-specific workout evidence");
  const diagnosis={
    modelTopPick:{horseNo:topNo,horseName:topPick.horseName,lockedRank:Number(topPick.rank),lockedScore:Number(topPick.score),actualFinish:actualByNo.get(topNo)},
    actualWinner:{horseNo:winnerNo,horseName:actualWinner.horse_name,modelRank:preds.findIndex(x=>Number(x.horseNo)===winnerNo)+1,lockedScore:Number((preds.find(x=>Number(x.horseNo)===winnerNo)||{}).score??NaN)},
    lockedScoreGapTopMinusWinner:round1(Number(topPick.score)-Number((preds.find(x=>Number(x.horseNo)===winnerNo)||{}).score||0)),
    topPickAdvantages,winnerAdvantages,confidenceRisks,
    interpretationPolicy:"These are attribution signals, not causal claims. A block with a large delta explains score separation in the model; it does not prove why the horse won or lost."
  };

  const createdAt=new Date().toISOString();
  const payload={race:{raceKey:race.race_key,raceName:race.race_name,venue:race.venue,distance:race.distance,trackCondition:track},lock:{modelVersion:lock.model_version,sealKind:lock.seal_kind,sealedAt:lock.sealed_at},diagnosis,biggestMisses,runnerDiagnostics:rows,weights:JSON.parse(lock.weights_json||JSON.stringify(WEIGHTS)),guardrails:{weightMutation:false,resultLeakage:"Predictions come from the sealed Step 1 snapshot; Step 4 only diagnoses after official outcomes are stored.",singleRaceWeightTuningProhibited:true}};
  await env.DB.prepare(`INSERT INTO lab_error_diagnostics (race_key,model_version,track_condition,diagnostic_json,created_at) VALUES (?,?,?,?,?) ON CONFLICT(race_key,model_version,track_condition) DO UPDATE SET diagnostic_json=excluded.diagnostic_json,created_at=excluded.created_at`).bind(race.race_key,lock.model_version,track,JSON.stringify(payload),createdAt).run();

  return{ok:true,stage:"full-boost-4-error-diagnostics",version:"2.9.0",step:4,...payload,persisted:true,createdAt,next:"Repeat Steps 1-4 on multiple prospectively sealed races, then aggregate recurring miss patterns before changing weights."};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.9.0",phase:"step 4 feature attribution and miss diagnostics"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===4)||u.pathname==="/v1/lab/error-diagnostics")return json(await step4Diagnostics(request,env));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"2.9.0",build:"step4-feature-attribution",now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"2.9.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
