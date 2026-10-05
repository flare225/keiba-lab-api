import app from "./index-v2.9.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);
  for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);
  let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}
  return{status:r.status,data:d};
}

async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}

async function safeCount(db,sql,bind=[]){
  try{const r=await db.prepare(sql).bind(...bind).first();return Number(r?.c||0)}catch{return 0}
}
async function safeRows(db,sql,bind=[]){
  try{const r=await db.prepare(sql).bind(...bind).all();return r.results||[]}catch{return[]}
}

async function sourceCoverage(db,raceKey,track,runnerCount){
  const baseRows=await safeRows(db,`SELECT horse_no,basic_score,recent_score,course_distance_score,ground_score FROM lab_prediction_snapshots WHERE race_key=? AND model_version='1.5.0' AND track_condition=? ORDER BY horse_no`,[raceKey,track]);
  const paceRows=await safeRows(db,`SELECT horse_no,pace_style_fit_score,evidence_confidence FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0' ORDER BY horse_no`,[raceKey]);
  const condRows=await safeRows(db,`SELECT horse_no,condition_prep_score,evidence_confidence FROM lab_condition_prep_snapshots WHERE race_key=? AND model_version='2.3.0' ORDER BY horse_no`,[raceKey]);
  const intRows=await safeRows(db,`SELECT horse_no,basic_score,recent_score,pace_style_score,course_distance_score,ground_score,condition_prep_score FROM lab_integrated_snapshots WHERE race_key=? AND model_version='2.3.0' AND track_condition=? ORDER BY horse_no`,[raceKey,track]);
  const workout=await safeRows(db,`SELECT horse_no,verified FROM lab_workout_evidence WHERE race_key=? ORDER BY horse_no`,[raceKey]);
  const countNonNull=(rows,key)=>rows.filter(x=>x[key]!=null&&Number.isFinite(Number(x[key]))).length;
  const pct=n=>runnerCount?round1(n/runnerCount*100):0;
  return{
    runnerCount,
    baseSnapshotRows:baseRows.length,
    baseBlocks:{
      basic:{count:countNonNull(baseRows,"basic_score"),pct:pct(countNonNull(baseRows,"basic_score"))},
      recent:{count:countNonNull(baseRows,"recent_score"),pct:pct(countNonNull(baseRows,"recent_score"))},
      courseDistance:{count:countNonNull(baseRows,"course_distance_score"),pct:pct(countNonNull(baseRows,"course_distance_score"))},
      ground:{count:countNonNull(baseRows,"ground_score"),pct:pct(countNonNull(baseRows,"ground_score"))}
    },
    paceStyle:{count:countNonNull(paceRows,"pace_style_fit_score"),pct:pct(countNonNull(paceRows,"pace_style_fit_score"))},
    conditionPrep:{count:countNonNull(condRows,"condition_prep_score"),pct:pct(countNonNull(condRows,"condition_prep_score"))},
    integratedRows:intRows.length,
    integratedCompleteSixBlocks:intRows.filter(x=>["basic_score","recent_score","pace_style_score","course_distance_score","ground_score","condition_prep_score"].every(k=>x[k]!=null&&Number.isFinite(Number(x[k])))).length,
    workoutVerified:{count:workout.filter(x=>Number(x.verified)===1).length,pct:pct(workout.filter(x=>Number(x.verified)===1).length)}
  };
}

async function ensureRepairTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_source_repair_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    track_condition TEXT NOT NULL,
    repair_version TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    preview_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(race_key,track_condition,repair_version)
  )`).run();
}

async function step5SourceRepair(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  const {race,runners}=await loadRace(env,date,venue,raceNo);
  await ensureRepairTable(env.DB);
  const before=await sourceCoverage(env.DB,race.race_key,track,runners.length);

  const base=await invoke(u.origin,"/v1/lab/rank",{date,venue,race_no:raceNo,track,persist:1},env,ctx);
  if(base.status>=400||base.data?.ok===false)throw new Error(`base feature rebuild failed: ${base.data?.error||base.status}`);

  const integrated=await invoke(u.origin,"/v1/lab/integrated",{date,venue,race_no:raceNo,track,persist:1},env,ctx);
  if(integrated.status>=400||integrated.data?.ok===false)throw new Error(`integrated rebuild failed: ${integrated.data?.error||integrated.status}`);

  const provisional=await invoke(u.origin,"/v1/lab/provisional-100",{date,venue,race_no:raceNo,track},env,ctx);
  if(provisional.status>=400||provisional.data?.ok===false)throw new Error(`provisional rebuild failed: ${provisional.data?.error||provisional.status}`);

  const overlay=await invoke(u.origin,"/v1/lab/workout-overlay",{date,venue,race_no:raceNo,track},env,ctx);
  if(overlay.status>=400||overlay.data?.ok===false)throw new Error(`workout overlay rebuild failed: ${overlay.data?.error||overlay.status}`);

  const after=await sourceCoverage(env.DB,race.race_key,track,runners.length);
  const preview=(overlay.data?.runners||[]).slice(0,5).map(r=>({rank:r.rank,horseNo:r.horseNo,horseName:r.horseName,score:r.confidenceAware100Points,workoutVerified:Boolean(r.workoutEvidence?.verified),baseComponents:r.baseComponents||null,conditionPrepProxyScore:r.conditionPrepProxyScore??null}));
  const oldLock=await env.DB.prepare(`SELECT model_version,seal_kind,sealed_at FROM lab_model_locks WHERE race_key=? AND track_condition=? ORDER BY id DESC LIMIT 1`).bind(race.race_key,track).first();
  const createdAt=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO lab_source_repair_audits (race_key,track_condition,repair_version,before_json,after_json,preview_json,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,track_condition,repair_version) DO UPDATE SET before_json=excluded.before_json,after_json=excluded.after_json,preview_json=excluded.preview_json,created_at=excluded.created_at`).bind(race.race_key,track,"3.0.0",JSON.stringify(before),JSON.stringify(after),JSON.stringify(preview),createdAt).run();

  const allCoreBase=Object.values(after.baseBlocks).every(x=>x.count===runners.length);
  return{
    ok:true,
    stage:"full-boost-5-source-coverage-repair",
    version:"3.0.0",
    step:5,
    race:{raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,trackCondition:track},
    repairKind:"post-race-feature-reconstruction",
    oldLock:{modelVersion:oldLock?.model_version??null,sealKind:oldLock?.seal_kind??null,sealedAt:oldLock?.sealed_at??null,untouched:true},
    before,
    after,
    repairChecks:{allCoreBaseBlocksComplete:allCoreBase,integratedSixBlockCompleteCount:after.integratedCompleteSixBlocks,runnerCount:runners.length},
    rebuiltTop5:preview,
    guardrails:{
      oldLockedPredictionIsNotOverwritten:true,
      targetRaceResultUsedForFeatureRebuild:false,
      historicalQueryCutoff:`race_date < ${date}`,
      prospectiveValidationCredit:false,
      weightMutation:false
    },
    persisted:true,
    createdAt,
    next:allCoreBase?"Create a separate repaired reconstruction lock, rerun attribution, and compare it with the original lock. Do not count this race as prospective validation.":"Inspect which base blocks still lack evidence before any learning or weight change."
  };
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.0.0",phase:"source coverage repair before learning"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===5)||u.pathname==="/v1/lab/source-repair")return json(await step5SourceRepair(request,env,ctx));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.0.0",build:"source-coverage-repair",now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.0.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
