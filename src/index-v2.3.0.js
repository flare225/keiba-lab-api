import app from "./index-v2.2.3.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);
  for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);
  let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}
  return{status:r.status,data:d};
}

function scoreConditionProxy(prep){
  if(!prep)return{score:null,confidence:"none",signals:0,reasons:["no prep proxy"]};
  let score=70;
  const reasons=[];

  if(prep.freshnessBucket==="standard"){score+=10;reasons.push("standard turnaround")}
  else if(prep.freshnessBucket==="fresh"){score+=7;reasons.push("fresh interval")}
  else if(prep.freshnessBucket==="short-turnaround"){score-=1;reasons.push("short turnaround")}
  else if(prep.freshnessBucket==="long-layoff"){score-=8;reasons.push("long layoff")}

  const change=Number(prep.currentBodyWeightChange);
  if(Number.isFinite(change)){
    const a=Math.abs(change);
    if(a<=4){score+=6;reasons.push("small current body-weight change")}
    else if(a<=8){score+=2;reasons.push("moderate current body-weight change")}
    else if(a<=14){score-=4;reasons.push("large current body-weight change")}
    else{score-=9;reasons.push("very large current body-weight change")}

    const hist=Number(prep.avgAbsHistoricalWeightChange);
    if(Number.isFinite(hist)){
      if(a<=hist+2){score+=3;reasons.push("weight change within historical range")}
      else if(a>=hist+8){score-=4;reasons.push("weight change outside historical range")}
    }
  } else {
    reasons.push("current body-weight change unavailable")
  }

  const signals=Number(prep.signalsAvailable||0);
  const confidence=signals>=4?"medium":signals>=2?"low":"very-low";
  const shrink=confidence==="medium"?0.75:confidence==="low"?0.55:0.35;
  const shrunk=70+(score-70)*shrink;

  return{score:round1(clamp(shrunk,45,92)),confidence,signals,reasons};
}

async function ensureConditionTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_condition_prep_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    condition_prep_score REAL,
    evidence_confidence TEXT,
    signals_available INTEGER,
    freshness_bucket TEXT,
    days_since_last_run INTEGER,
    current_body_weight INTEGER,
    current_body_weight_change INTEGER,
    avg_abs_historical_weight_change REAL,
    evidence_kind TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no,model_version)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_condition_race ON lab_condition_prep_snapshots(race_key,model_version,horse_no)").run();
}

async function ensureIntegratedTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_integrated_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    prefinal_points REAL,
    available_weight REAL,
    normalized_evidence_score REAL,
    basic_score REAL,
    recent_score REAL,
    pace_style_score REAL,
    course_distance_score REAL,
    ground_score REAL,
    condition_prep_score REAL,
    final_prediction INTEGER NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no,model_version,track_condition)
  )`).run();
}

async function provisional100(request,env,ctx){
  const url=new URL(request.url);
  const date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no")),track=url.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");

  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");

  const integrated=await invoke(url.origin,"/v1/lab/integrated",{date,venue,race_no:raceNo,track,persist:1},env,ctx);
  if(integrated.status>=400||integrated.data?.ok===false)throw new Error(`integrated model failed: ${integrated.data?.error||integrated.status}`);

  const condition=await invoke(url.origin,"/v1/lab/condition-debug",{date,venue,race_no:raceNo,sample:race.runner_count},env,ctx);
  if(condition.status>=400||condition.data?.ok===false)throw new Error(`condition diagnostics failed: ${condition.data?.error||condition.status}`);

  const conditionByName=new Map((condition.data?.samples||[]).map(x=>[x.horseName,x]));
  const rows=[];
  const generatedAt=new Date().toISOString();

  await ensureConditionTable(env.DB);
  await ensureIntegratedTable(env.DB);

  for(const base of integrated.data?.runners||[]){
    const sample=conditionByName.get(base.horseName)||null;
    const prep=sample?.prepProxy||null;
    const c=scoreConditionProxy(prep);
    const conditionPoints=c.score==null?0:round1(c.score*0.10);
    const provisionalPoints=c.score==null?base.preFinalPoints:round1(Number(base.preFinalPoints||0)+conditionPoints);

    const row={
      horseNo:base.horseNo,frameNo:base.frameNo,horseName:base.horseName,
      preFinal90Points:base.preFinalPoints,conditionPrepProxyScore:c.score,
      conditionPrepPoints:conditionPoints,provisional100Points:provisionalPoints,
      conditionEvidenceConfidence:c.confidence,conditionSignals:c.signals,
      conditionReasons:c.reasons,prepProxy:prep,
      baseComponents:base.components,style:base.style,
      evidenceFlags:{paceStyleImputed:base.style?.evidenceConfidence?.startsWith("neutral-imputation")||false,conditionIsProxy:true}
    };
    rows.push(row);

    await env.DB.prepare(`INSERT INTO lab_condition_prep_snapshots
      (race_key,horse_no,horse_name,model_version,condition_prep_score,evidence_confidence,signals_available,freshness_bucket,days_since_last_run,current_body_weight,current_body_weight_change,avg_abs_historical_weight_change,evidence_kind,generated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(race_key,horse_no,model_version) DO UPDATE SET
        horse_name=excluded.horse_name,condition_prep_score=excluded.condition_prep_score,evidence_confidence=excluded.evidence_confidence,signals_available=excluded.signals_available,freshness_bucket=excluded.freshness_bucket,days_since_last_run=excluded.days_since_last_run,current_body_weight=excluded.current_body_weight,current_body_weight_change=excluded.current_body_weight_change,avg_abs_historical_weight_change=excluded.avg_abs_historical_weight_change,evidence_kind=excluded.evidence_kind,generated_at=excluded.generated_at`)
      .bind(race.race_key,base.horseNo,base.horseName,"2.3.0",c.score,c.confidence,c.signals,prep?.freshnessBucket??null,prep?.daysSinceLastRun??null,prep?.currentBodyWeight??null,prep?.currentBodyWeightChange??null,prep?.avgAbsHistoricalWeightChange??null,"proxy-not-workout-quality",generatedAt).run();

    await env.DB.prepare(`INSERT INTO lab_integrated_snapshots
      (race_key,horse_no,horse_name,model_version,track_condition,prefinal_points,available_weight,normalized_evidence_score,basic_score,recent_score,pace_style_score,course_distance_score,ground_score,condition_prep_score,final_prediction,generated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(race_key,horse_no,model_version,track_condition) DO UPDATE SET
        horse_name=excluded.horse_name,prefinal_points=excluded.prefinal_points,available_weight=excluded.available_weight,normalized_evidence_score=excluded.normalized_evidence_score,basic_score=excluded.basic_score,recent_score=excluded.recent_score,pace_style_score=excluded.pace_style_score,course_distance_score=excluded.course_distance_score,ground_score=excluded.ground_score,condition_prep_score=excluded.condition_prep_score,final_prediction=excluded.final_prediction,generated_at=excluded.generated_at`)
      .bind(race.race_key,base.horseNo,base.horseName,"2.3.0",track,provisionalPoints,100,provisionalPoints,base.components?.basicAbilityResults??null,base.components?.recentPerformanceDevelopment??null,base.components?.paceStyleFit??null,base.components?.courseDistanceFit??null,base.components?.ground??null,c.score,0,generatedAt).run();
  }

  rows.sort((a,b)=>Number(b.provisional100Points||-1)-Number(a.provisional100Points||-1)||Number(a.horseNo)-Number(b.horseNo));
  rows.forEach((r,i)=>r.provisionalRank=i+1);
  const medium=rows.filter(r=>r.conditionEvidenceConfidence==="medium").length;
  const low=rows.filter(r=>r.conditionEvidenceConfidence==="low").length;
  const veryLow=rows.filter(r=>r.conditionEvidenceConfidence==="very-low").length;
  const paceImputed=rows.filter(r=>r.evidenceFlags.paceStyleImputed).length;

  return{
    ok:true,stage:"provisional-100-point-confidence-aware-model",version:"2.3.0",
    race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,surface:race.surface,distance:race.distance,runnerCount:race.runner_count,trackConditionInput:track},
    modelCoveragePct:100,finalPrediction:false,provisional100:true,
    conditionPrepPolicy:"The final 10-point block is filled only with pre-race proxy evidence currently available (turnaround/body-weight stability). It is explicitly NOT treated as workout quality. Scores are shrunk toward neutral by evidence confidence and should be replaced when validated runner-specific workout evidence is available.",
    conditionEvidenceSummary:{medium,low,veryLow,paceStyleNeutralImputations:paceImputed},
    leakageGuard:`Historical prep inputs are restricted to races before ${date}; target-race finishing result is not used.`,
    persistedConditionSnapshots:rows.length,persistedIntegratedSnapshots:rows.length,
    top5:rows.slice(0,5).map(r=>({rank:r.provisionalRank,horseNo:r.horseNo,horseName:r.horseName,provisional100Points:r.provisional100Points,conditionPrepProxyScore:r.conditionPrepProxyScore,conditionEvidenceConfidence:r.conditionEvidenceConfidence})),
    runners:rows,
    next:"Validate runner-specific workout/condition evidence, replace proxy condition scores where available, then promote finalPrediction=true only after historical backtest/holdout checks."
  };
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.3.0",phase:"confidence-aware provisional 100-point model"});
    if(url.pathname==="/v1/lab/provisional-100"){
      if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
      try{return json(await provisional100(request,env,ctx))}catch(e){return json({ok:false,version:"2.3.0",error:String(e)},500)}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
