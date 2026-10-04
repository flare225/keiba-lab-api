import app from "./index-v2.2.2.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}

async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}

async function fill(request,env,ctx){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no")),track=url.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");

  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  const runners=rr.results||[];
  const sr=await env.DB.prepare(`SELECT horse_no FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0'`).bind(race.race_key).all();
  const have=new Set((sr.results||[]).map(r=>Number(r.horse_no)));
  const missing=runners.filter(r=>!have.has(Number(r.horse_no)));
  const bias=await env.DB.prepare(`SELECT pace_bias,lane_bias,confidence FROM lab_track_bias_snapshots WHERE race_key=? ORDER BY generated_at DESC LIMIT 1`).bind(race.race_key).first();
  const generatedAt=new Date().toISOString();
  const filled=[];

  for(const runner of missing){
    const p=await env.DB.prepare(`SELECT race_date,race_name,field_size FROM jra_past_performances WHERE horse_name=? AND race_date<? ORDER BY race_date DESC LIMIT 1`).bind(runner.horse_name,date).first();
    await env.DB.prepare(`INSERT INTO lab_pace_style_snapshots (race_key,horse_no,horse_name,model_version,style_key,style_label,source_race_date,source_race_name,final_corner,source_field_size,corner_percentile,pace_bias,lane_bias,bias_confidence,raw_fit_score,pace_style_fit_score,evidence_confidence,generated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no,model_version) DO UPDATE SET horse_name=excluded.horse_name,style_key=excluded.style_key,style_label=excluded.style_label,source_race_date=excluded.source_race_date,source_race_name=excluded.source_race_name,final_corner=excluded.final_corner,source_field_size=excluded.source_field_size,corner_percentile=excluded.corner_percentile,pace_bias=excluded.pace_bias,lane_bias=excluded.lane_bias,bias_confidence=excluded.bias_confidence,raw_fit_score=excluded.raw_fit_score,pace_style_fit_score=excluded.pace_style_fit_score,evidence_confidence=excluded.evidence_confidence,generated_at=excluded.generated_at`).bind(race.race_key,runner.horse_no,runner.horse_name,"1.8.0","unknown","不明",p?.race_date??null,p?.race_name??null,null,p?.field_size??null,null,bias?.pace_bias??"insufficient-data",bias?.lane_bias??"insufficient-data",bias?.confidence??"low",72,72,"neutral-imputation-missing-official-corner-source",generatedAt).run();
    filled.push({horseNo:runner.horse_no,horseName:runner.horse_name,paceStyleFitScore:72,evidenceConfidence:"neutral-imputation-missing-official-corner-source"});
  }

  const countRow=await env.DB.prepare(`SELECT COUNT(*) AS n FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0'`).bind(race.race_key).first();
  const paceCount=Number(countRow?.n||0);
  const integrated=await invoke(url.origin,"/v1/lab/integrated",{date,venue,race_no:raceNo,track,persist:1},env,ctx);

  return {ok:paceCount===runners.length,stage:"pace-style-coverage-complete",version:"2.2.3",race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,distance:race.distance,runnerCount:runners.length},observedBefore:runners.length-missing.length,neutralImputed:filled.length,paceStyleSnapshotCount:paceCount,coveragePct:runners.length?round1(paceCount/runners.length*100):0,filled,integrated90:{ok:integrated.status<400&&integrated.data?.ok!==false,complete90Count:integrated.data?.complete90Count??null,persistedSnapshots:integrated.data?.persistedSnapshots??null},policy:"Missing official corner evidence is filled at neutral 72 only; it is never guessed as front/closer. The imputation is explicitly tagged so later verified evidence can replace it.",next:paceCount===runners.length?"Proceed to validated condition/prep evidence and the final 100-point model.":"Coverage still incomplete; inspect D1 rows."};
}

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.2.3",phase:"confidence-aware pace-style coverage completion"});if(url.pathname==="/v1/lab/pace-fill-neutral"){if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{return json(await fill(request,env,ctx))}catch(e){return json({ok:false,version:"2.2.3",error:String(e)},500)}}return app.fetch(request,env,ctx)},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
