import app from "./index-v3.2.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function jstDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
async function sha256Hex(text){
  const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d};
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_prospective_seals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    race_date TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT NOT NULL,
    seal_kind TEXT NOT NULL,
    snapshot_sha256 TEXT NOT NULL,
    runner_count INTEGER NOT NULL,
    outcome_count_at_seal INTEGER NOT NULL,
    future_day_lock INTEGER NOT NULL,
    quality_json TEXT NOT NULL,
    sealed_at TEXT NOT NULL,
    UNIQUE(race_key,model_version,track_condition)
  )`).run();
}
async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1; ingest the race card first");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}
function componentPresent(v){
  if(v==null)return false;
  if(Number.isFinite(Number(v)))return true;
  if(typeof v==="object")return [v.score,v.points,v.rawScore,v.normalizedScore].some(x=>Number.isFinite(Number(x)));
  return false;
}
async function step7ProspectiveSeal(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue and race_no=1-12 are required");
  await ensureTables(env.DB);
  const {race,runners}=await loadRace(env,date,venue,raceNo);
  if(runners.length!==Number(race.runner_count||runners.length))throw new Error(`runner card coverage incomplete: ${runners.length}/${race.runner_count}`);

  const today=jstDate();
  if(date<today)return{
    ok:false,stage:"full-boost-7-prospective-seal",version:"3.3.0",step:7,raceKey:race.race_key,
    error:"past races cannot receive prospective validation credit",raceDate:date,todayJst:today,
    next:"Use a future race. Post-race reconstruction remains diagnostic only."
  };

  const oc=await env.DB.prepare(`SELECT COUNT(*) AS c FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL`).bind(race.race_key).first();
  const outcomeCount=Number(oc?.c||0);
  if(outcomeCount>0)return{
    ok:false,stage:"full-boost-7-prospective-seal",version:"3.3.0",step:7,raceKey:race.race_key,
    error:"official outcomes already exist; prospective sealing refused",outcomeCount
  };

  const modelVersion="3.3.0-prospective";
  const existing=await env.DB.prepare(`SELECT l.snapshot_json,l.seal_kind,l.sealed_at,s.snapshot_sha256,s.quality_json,s.future_day_lock FROM lab_model_locks l LEFT JOIN lab_prospective_seals s ON s.race_key=l.race_key AND s.model_version=l.model_version AND s.track_condition=l.track_condition WHERE l.race_key=? AND l.model_version=? AND l.track_condition=?`).bind(race.race_key,modelVersion,track).first();
  if(existing){
    const snap=JSON.parse(existing.snapshot_json||"{}");
    return{ok:true,stage:"full-boost-7-prospective-seal",version:"3.3.0",step:7,idempotent:true,immutable:true,race:snap.race,seal:{modelVersion,sealKind:existing.seal_kind,sealedAt:existing.sealed_at,snapshotSha256:existing.snapshot_sha256,futureDayLock:Boolean(existing.future_day_lock)},quality:JSON.parse(existing.quality_json||"{}"),top5:snap.top5||[],next:"Do not reseal. After the race, ingest official outcomes and validate this exact hash-locked snapshot."};
  }

  const overlay=await invoke(u.origin,"/v1/lab/workout-overlay",{date,venue,race_no:raceNo,track},env,ctx);
  if(overlay.status>=400||overlay.data?.ok===false)throw new Error(`prediction pipeline failed: ${overlay.data?.error||overlay.status}`);
  const sourceRows=overlay.data?.runners||[];
  if(sourceRows.length!==runners.length)throw new Error(`prediction coverage incomplete: ${sourceRows.length}/${runners.length}`);

  const predictions=sourceRows.map(r=>({
    horseNo:Number(r.horseNo),frameNo:Number(r.frameNo),horseName:r.horseName,rank:Number(r.rank),score:Number(r.confidenceAware100Points),
    workoutOverlayApplied:Boolean(r.workoutOverlayApplied),workoutVerified:Boolean(r.workoutEvidence?.verified),workoutEvidenceConfidence:r.workoutEvidence?.confidence||null,
    paceStyleImputed:Boolean(r.evidenceFlags?.paceStyleImputed),conditionEvidenceConfidence:r.conditionEvidenceConfidence||null,
    components:r.baseComponents||null,conditionPrepProxyScore:r.conditionPrepProxyScore??null
  })).sort((a,b)=>a.rank-b.rank);

  const componentKeys=["basicAbilityResults","recentPerformanceDevelopment","paceStyleFit","courseDistanceFit","ground"];
  const componentCoverage={};
  for(const k of componentKeys){
    const c=predictions.filter(r=>componentPresent(r.components?.[k])).length;
    componentCoverage[k]={count:c,pct:round1(c/predictions.length*100)};
  }
  const verifiedWorkoutCount=predictions.filter(r=>r.workoutVerified).length;
  const paceImputedCount=predictions.filter(r=>r.paceStyleImputed).length;
  const conditionNonVeryLowCount=predictions.filter(r=>!["very-low","none",null].includes(r.conditionEvidenceConfidence)).length;
  const futureDayLock=date>today;
  const sealKind=futureDayLock?"prospective-holdout":"same-day-pre-result-time-unverified";
  const quality={
    predictionCoveragePct:100,
    componentCoverage,
    verifiedWorkoutCount,verifiedWorkoutPct:round1(verifiedWorkoutCount/predictions.length*100),
    paceStyleImputedCount,paceStyleObservedPct:round1((predictions.length-paceImputedCount)/predictions.length*100),
    conditionEvidenceNonVeryLowCount,conditionEvidenceNonVeryLowPct:round1(conditionNonVeryLowCount/predictions.length*100),
    outcomeCountAtSeal:0,
    validationCreditEligible:futureDayLock
  };
  const weights={basicAbilityResults:25,recentPerformanceDevelopment:20,paceStyleFit:20,courseDistanceFit:15,ground:10,conditionPrep:10};
  const sealedAt=new Date().toISOString();
  const snapshot={
    schemaVersion:"3.3.0",race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,surface:race.surface,distance:race.distance,runnerCount:runners.length,trackCondition:track},
    sealKind,sourcePipeline:"repaired-history-parser + confidence-aware overlay",weights,quality,
    top5:predictions.slice(0,5),runners:predictions
  };
  const snapshotJson=JSON.stringify(snapshot);
  const hash=await sha256Hex(snapshotJson);

  await env.DB.prepare(`INSERT INTO lab_model_locks (race_key,model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at) VALUES (?,?,?,?,?,?,?)`).bind(race.race_key,modelVersion,track,sealKind,JSON.stringify(weights),snapshotJson,sealedAt).run();
  await env.DB.prepare(`INSERT INTO lab_prospective_seals (race_key,race_date,model_version,track_condition,seal_kind,snapshot_sha256,runner_count,outcome_count_at_seal,future_day_lock,quality_json,sealed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(race.race_key,date,modelVersion,track,sealKind,hash,runners.length,0,futureDayLock?1:0,JSON.stringify(quality),sealedAt).run();

  return{
    ok:true,stage:"full-boost-7-prospective-seal",version:"3.3.0",step:7,
    race:snapshot.race,
    seal:{modelVersion,sealKind,sealedAt,snapshotSha256:hash,immutable:true,futureDayLock,prospectiveValidationCreditEligible:futureDayLock},
    quality,
    top5:snapshot.top5,
    guardrails:{officialOutcomeRowsAtSeal:0,targetResultQueried:false,weightMutation:false,resealOverwritesExisting:false,snapshotTamperEvidence:"SHA-256"},
    next:futureDayLock?"Keep this snapshot untouched. After the race, ingest official outcomes and run prospective validation against this exact sealed hash.":"This same-day seal is useful operationally but does not receive strict future-day holdout credit because post time is not stored yet."
  };
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.3.0",phase:"immutable prospective pre-result sealing"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===7)||u.pathname==="/v1/lab/prospective-seal")return json(await step7ProspectiveSeal(request,env,ctx));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.3.0",build:"prospective-seal",now:new Date().toISOString(),todayJst:jstDate()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.3.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
