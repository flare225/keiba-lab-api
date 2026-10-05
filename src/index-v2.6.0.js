import app from "./index-v2.5.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function round1(v){return Math.round(Number(v||0)*10)/10}

async function ensureWorkoutEvidenceTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_workout_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    score REAL NOT NULL,
    grade TEXT,
    confidence TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_note TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_workout_evidence_race ON lab_workout_evidence(race_key,horse_no)").run();
}

async function loadRaceAndRunners(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}

async function workoutTemplate(request,env){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  await ensureWorkoutEvidenceTable(env.DB);
  const {race,runners}=await loadRaceAndRunners(env,date,venue,raceNo);
  const er=await env.DB.prepare(`SELECT horse_no,score,grade,confidence,source_kind,source_note,verified,updated_at FROM lab_workout_evidence WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  const evidenceByNo=new Map((er.results||[]).map(x=>[Number(x.horse_no),x]));
  const rows=runners.map(r=>({horseNo:r.horse_no,frameNo:r.frame_no,horseName:r.horse_name,evidence:evidenceByNo.get(Number(r.horse_no))||null}));
  const filled=rows.filter(r=>r.evidence).length;
  const verified=rows.filter(r=>Number(r.evidence?.verified||0)===1).length;
  return{
    ok:true,stage:"runner-workout-evidence-template",version:"2.6.0",
    race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,surface:race.surface,distance:race.distance,runnerCount:race.runner_count},
    evidenceCoverage:{filled,verified,runnerCount:runners.length,filledPct:runners.length?round1(filled/runners.length*100):0,verifiedPct:runners.length?round1(verified/runners.length*100):0},
    runners:rows,
    inputPolicy:{score:"0-100 runner-specific workout/condition score",grade:"optional A/B/C/D or text label",confidence:"high/medium/low",sourceKind:"manual/jra-official/other-verified",verified:"set 1 only when horse-level evidence has been checked"},
    next:"Add runner-specific evidence, then call /v1/lab/workout-overlay to recompute the 100-point model without fabricating missing workout scores."
  };
}

async function saveWorkoutEvidence(request,env){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no")),horseNo=Number(url.searchParams.get("horse_no"));
  const score=Number(url.searchParams.get("score"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12||!Number.isInteger(horseNo)||horseNo<1)throw new Error("date, venue, race_no and horse_no are required");
  if(!Number.isFinite(score)||score<0||score>100)throw new Error("score must be 0-100");
  await ensureWorkoutEvidenceTable(env.DB);
  const {race,runners}=await loadRaceAndRunners(env,date,venue,raceNo);
  const runner=runners.find(r=>Number(r.horse_no)===horseNo);
  if(!runner)throw new Error("runner not found");
  const grade=url.searchParams.get("grade")||null;
  const confidence=(url.searchParams.get("confidence")||"medium").toLowerCase();
  if(!["high","medium","low"].includes(confidence))throw new Error("confidence must be high, medium or low");
  const sourceKind=url.searchParams.get("source_kind")||"manual";
  const note=url.searchParams.get("note")||null;
  const verified=url.searchParams.get("verified")==="1"?1:0;
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO lab_workout_evidence
    (race_key,horse_no,horse_name,score,grade,confidence,source_kind,source_note,verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_key,horse_no) DO UPDATE SET
      horse_name=excluded.horse_name,score=excluded.score,grade=excluded.grade,confidence=excluded.confidence,source_kind=excluded.source_kind,source_note=excluded.source_note,verified=excluded.verified,updated_at=excluded.updated_at`)
    .bind(race.race_key,horseNo,runner.horse_name,clamp(score,0,100),grade,confidence,sourceKind,note,verified,now,now).run();
  return{ok:true,stage:"runner-workout-evidence-saved",version:"2.6.0",raceKey:race.race_key,horseNo,horseName:runner.horse_name,score:clamp(score,0,100),grade,confidence,sourceKind,note,verified:Boolean(verified)};
}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d};
}

async function workoutOverlay(request,env,ctx){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no")),track=url.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  await ensureWorkoutEvidenceTable(env.DB);
  const {race,runners}=await loadRaceAndRunners(env,date,venue,raceNo);
  const base=await invoke(url.origin,"/v1/lab/provisional-100",{date,venue,race_no:raceNo,track},env,ctx);
  if(base.status>=400||base.data?.ok===false)throw new Error(`provisional model failed: ${base.data?.error||base.status}`);
  const er=await env.DB.prepare(`SELECT horse_no,score,grade,confidence,source_kind,source_note,verified FROM lab_workout_evidence WHERE race_key=?`).bind(race.race_key).all();
  const evidenceByNo=new Map((er.results||[]).map(x=>[Number(x.horse_no),x]));
  const rows=(base.data?.runners||[]).map(r=>{
    const ev=evidenceByNo.get(Number(r.horseNo))||null;
    const workoutScore=ev?Number(ev.score):null;
    const finalPoints=ev?round1(Number(r.preFinal90Points||0)+workoutScore*0.10):r.provisional100Points;
    return{...r,workoutEvidence:ev,workoutOverlayApplied:Boolean(ev),workoutScore,workoutPoints:ev?round1(workoutScore*0.10):null,confidenceAware100Points:finalPoints};
  });
  rows.sort((a,b)=>Number(b.confidenceAware100Points||-1)-Number(a.confidenceAware100Points||-1)||Number(a.horseNo)-Number(b.horseNo));
  rows.forEach((r,i)=>r.rank=i+1);
  const filled=rows.filter(r=>r.workoutOverlayApplied).length;
  const verified=rows.filter(r=>Number(r.workoutEvidence?.verified||0)===1).length;
  return{
    ok:true,stage:"runner-workout-evidence-overlay",version:"2.6.0",
    race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,surface:race.surface,distance:race.distance,runnerCount:race.runner_count,trackConditionInput:track},
    workoutCoverage:{filled,verified,runnerCount:runners.length,filledPct:runners.length?round1(filled/runners.length*100):0,verifiedPct:runners.length?round1(verified/runners.length*100):0},
    finalPrediction:false,
    promotionPolicy:"Runner-specific workout evidence replaces only the provisional condition block. finalPrediction remains false until verified workout coverage is sufficient and historical holdout/backtest validation is completed.",
    top5:rows.slice(0,5).map(r=>({rank:r.rank,horseNo:r.horseNo,horseName:r.horseName,score:r.confidenceAware100Points,workoutOverlayApplied:r.workoutOverlayApplied,workoutVerified:Boolean(r.workoutEvidence?.verified)})),
    runners:rows,
    next:verified===runners.length?"Run historical holdout/backtest validation before promoting finalPrediction=true.":"Fill/verify runner-specific workout evidence where available; missing runners remain on the explicit provisional proxy rather than fabricated workout scores."
  };
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.6.0",phase:"runner-level workout evidence pipeline"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(url.pathname==="/v1/lab/workout-template")return json(await workoutTemplate(request,env));
      if(url.pathname==="/v1/lab/workout-evidence")return json(await saveWorkoutEvidence(request,env));
      if(url.pathname==="/v1/lab/workout-overlay")return json(await workoutOverlay(request,env,ctx));
      return app.fetch(request,env,ctx);
    }catch(e){return json({ok:false,version:"2.6.0",error:String(e)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
