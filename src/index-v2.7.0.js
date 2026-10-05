import app from "./index-v2.6.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function text(value){return String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim()}
function rowCells(rowHtml){return [...String(rowHtml||"").matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>text(m[1]))}
function parseJapaneseDate(value){const m=String(value||"").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`:null}
function todayJst(){return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)}

async function fetchHtml(url){
  const response=await fetch(url,{headers:{"user-agent":"keiba-lab/2.7.0 (+validation audit)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});
  const buffer=await response.arrayBuffer();
  let body;try{body=new TextDecoder("shift_jis").decode(buffer)}catch{body=new TextDecoder("utf-8").decode(buffer)}
  return{ok:response.ok,status:response.status,url:response.url,body};
}

function extractProfileLinks(html,runnerNames,baseUrl){
  const wanted=new Set(runnerNames),found=new Map();
  const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){
    const anchorText=text(m[2]);if(!wanted.has(anchorText)||found.has(anchorText))continue;
    try{const u=new URL(m[1].replace(/&amp;/g,"&"),baseUrl);const cname=u.searchParams.get("CNAME")||"";if(!/\/JRADB\/accessU\.html/i.test(u.pathname))continue;if(!/^pw01dud\d{2}/i.test(cname))continue;found.set(anchorText,u.href)}catch{}
  }
  return found;
}

function findTargetResult(profileHtml,raceDate,raceName){
  let loose=null;
  for(const match of String(profileHtml||"").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=rowCells(match[1]);if(cells.length<9)continue;
    const d=parseJapaneseDate(cells[0]);const rowText=text(match[1]);
    if(d!==raceDate)continue;
    const finishText=String(cells[8]||"").trim();
    const finish=/^\d+$/.test(finishText)?Number(finishText):null;
    const item={finishPosition:finish,cells:cells.slice(0,16),rowText};
    if(raceName&&rowText.includes(raceName))return item;
    if(!loose)loose=item;
  }
  return loose;
}

async function mapLimit(items,limit,worker){
  const output=new Array(items.length);let next=0;
  async function run(){while(true){const i=next++;if(i>=items.length)return;output[i]=await worker(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return output;
}

async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}

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
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_race_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    finish_position INTEGER,
    source_kind TEXT NOT NULL,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no)
  )`).run();
}

async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,source_url FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}

async function stage1Lock(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureTables(env.DB);const {race}=await loadRace(env,date,venue,raceNo);
  const overlay=await invoke(u.origin,"/v1/lab/workout-overlay",{date,venue,race_no:raceNo,track},env,ctx);
  if(overlay.status>=400||overlay.data?.ok===false)throw new Error(`workout overlay failed: ${overlay.data?.error||overlay.status}`);
  const sealKind=date<todayJst()?"post-race-reconstruction":"pre-result-candidate";
  const weights={basicAbilityResults:25,recentPerformanceDevelopment:20,paceStyleFit:20,courseDistanceFit:15,ground:10,conditionPrep:10};
  const snapshot={race:overlay.data?.race,workoutCoverage:overlay.data?.workoutCoverage,top5:overlay.data?.top5,runners:(overlay.data?.runners||[]).map(r=>({horseNo:r.horseNo,horseName:r.horseName,rank:r.rank,score:r.confidenceAware100Points,workoutVerified:Boolean(r.workoutEvidence?.verified),paceStyleImputed:Boolean(r.evidenceFlags?.paceStyleImputed)}))};
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO lab_model_locks (race_key,model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,model_version,track_condition) DO UPDATE SET seal_kind=excluded.seal_kind,weights_json=excluded.weights_json,snapshot_json=excluded.snapshot_json,sealed_at=excluded.sealed_at`).bind(race.race_key,"2.7.0",track,sealKind,JSON.stringify(weights),JSON.stringify(snapshot),now).run();
  return{ok:true,stage:"full-boost-1-model-lock",version:"2.7.0",step:1,raceKey:race.race_key,sealKind,weights,workoutCoverage:overlay.data?.workoutCoverage,top5:overlay.data?.top5,nextStep:2,note:sealKind==="post-race-reconstruction"?"This race is already in the past, so this lock is explicitly a reconstruction audit, not a prospective holdout.":"Candidate pre-result lock created. Do not tune weights after results are known."};
}

async function stage2Outcome(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureTables(env.DB);const {race,runners}=await loadRace(env,date,venue,raceNo);if(!race.source_url)throw new Error("race source_url is missing");
  const racePage=await fetchHtml(race.source_url);if(!racePage.ok)throw new Error(`race page HTTP ${racePage.status}`);
  const links=extractProfileLinks(racePage.body,runners.map(r=>r.horse_name),racePage.url);
  const fetched=await mapLimit(runners,4,async r=>{
    const profileUrl=links.get(r.horse_name)||null;if(!profileUrl)return{...r,status:"profile-link-not-found",finishPosition:null,profileUrl:null};
    try{const p=await fetchHtml(profileUrl);if(!p.ok)return{...r,status:`profile-http-${p.status}`,finishPosition:null,profileUrl};const found=findTargetResult(p.body,race.race_date,race.race_name);return{...r,status:found?.finishPosition?"found":found?"row-found-no-finish":"target-row-not-found",finishPosition:found?.finishPosition??null,profileUrl}}catch(e){return{...r,status:"error",error:String(e),finishPosition:null,profileUrl}}
  });
  const now=new Date().toISOString();let saved=0;
  for(const x of fetched){if(!Number.isInteger(x.finishPosition))continue;await env.DB.prepare(`INSERT INTO lab_race_outcomes (race_key,horse_no,horse_name,finish_position,source_kind,source_url,fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET horse_name=excluded.horse_name,finish_position=excluded.finish_position,source_kind=excluded.source_kind,source_url=excluded.source_url,fetched_at=excluded.fetched_at`).bind(race.race_key,x.horse_no,x.horse_name,x.finishPosition,"jra-horse-profile-target-row",x.profileUrl,now).run();saved++}
  const complete=saved===runners.length;
  return{ok:saved>0,stage:"full-boost-2-official-outcome-ingest",version:"2.7.0",step:2,raceKey:race.race_key,profileLinksFound:links.size,savedOutcomes:saved,runnerCount:runners.length,coveragePct:runners.length?round1(saved/runners.length*100):0,complete,results:fetched.map(x=>({horseNo:x.horse_no,horseName:x.horse_name,status:x.status,finishPosition:x.finishPosition})),nextStep:3};
}

async function stage3Audit(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureTables(env.DB);const {race,runners}=await loadRace(env,date,venue,raceNo);
  const lock=await env.DB.prepare(`SELECT model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at FROM lab_model_locks WHERE race_key=? AND model_version='2.7.0' AND track_condition=?`).bind(race.race_key,track).first();
  if(!lock)return{ok:false,stage:"full-boost-3-validation-audit",version:"2.7.0",step:3,error:"model lock missing; run step=1 first"};
  const or=await env.DB.prepare(`SELECT horse_no,horse_name,finish_position FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL ORDER BY finish_position`).bind(race.race_key).all();
  const outcomes=or.results||[];if(outcomes.length<3)return{ok:false,stage:"full-boost-3-validation-audit",version:"2.7.0",step:3,error:"not enough official outcomes; run step=2 first",outcomeCount:outcomes.length};
  const snap=JSON.parse(lock.snapshot_json||"{}");const preds=(snap.runners||[]).slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
  const actualByNo=new Map(outcomes.map(x=>[Number(x.horse_no),Number(x.finish_position)]));
  const predictedTop3=preds.slice(0,3);const actualTop3=outcomes.filter(x=>Number(x.finish_position)<=3).slice(0,3);
  const actualTop3Nos=new Set(actualTop3.map(x=>Number(x.horse_no)));const overlap=predictedTop3.filter(x=>actualTop3Nos.has(Number(x.horseNo))).length;
  const predictedWinner=preds[0]||null;const actualWinner=outcomes.find(x=>Number(x.finish_position)===1)||null;
  const winnerRank=actualWinner?preds.findIndex(x=>Number(x.horseNo)===Number(actualWinner.horse_no))+1:null;
  const predWinnerFinish=predictedWinner?actualByNo.get(Number(predictedWinner.horseNo))??null:null;
  const matched=preds.filter(p=>actualByNo.has(Number(p.horseNo))).map(p=>({horseNo:p.horseNo,horseName:p.horseName,predictedRank:p.rank,predictedScore:p.score,actualFinish:actualByNo.get(Number(p.horseNo))}));
  const validationType=lock.seal_kind==="pre-result-candidate"?"prospective-candidate":"post-race-reconstruction-audit";
  return{ok:true,stage:"full-boost-3-validation-audit",version:"2.7.0",step:3,raceKey:race.race_key,validationType,sealKind:lock.seal_kind,sealedAt:lock.sealed_at,outcomeCoveragePct:round1(outcomes.length/runners.length*100),metrics:{actualWinner:actualWinner?{horseNo:actualWinner.horse_no,horseName:actualWinner.horse_name}:null,modelTopPick:predictedWinner?{horseNo:predictedWinner.horseNo,horseName:predictedWinner.horseName,actualFinish:predWinnerFinish}:null,actualWinnerModelRank:winnerRank,top3Overlap:overlap,top3RecallPct:round1(overlap/3*100),winnerInModelTop3:winnerRank!=null&&winnerRank<=3},matched,weights:JSON.parse(lock.weights_json||"{}"),promotionPolicy:"Never tune weights on this race result. Accumulate multiple prospectively locked races and evaluate holdout metrics before changing weights or setting finalPrediction=true.",finalPredictionEligible:false,next:"Accumulate prospectively locked races; add verified workout evidence where available; then aggregate holdout metrics across races."};
}

async function fullBoost(request,env,ctx){const u=new URL(request.url),step=Number(u.searchParams.get("step")||1);if(step===1)return stage1Lock(request,env,ctx);if(step===2)return stage2Outcome(request,env);if(step===3)return stage3Audit(request,env);throw new Error("step must be 1, 2 or 3")}

export default{async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.7.0",phase:"three-stage validation boost"});if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{if(u.pathname==="/v1/lab/full-boost")return json(await fullBoost(request,env,ctx));if(u.pathname==="/v1/lab/model-lock")return json(await stage1Lock(request,env,ctx));if(u.pathname==="/v1/lab/result-ingest")return json(await stage2Outcome(request,env));if(u.pathname==="/v1/lab/validation-audit")return json(await stage3Audit(request,env));return app.fetch(request,env,ctx)}catch(e){return json({ok:false,version:"2.7.0",error:String(e)},500)}},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
