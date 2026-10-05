import app from "./index-v3.6.1.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);
  for(const[k,v] of Object.entries(params||{})) if(v!=null) u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);
  let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}
  return {status:r.status,data:d};
}

async function audit(env,from,to){
  const p=await env.DB.prepare(`SELECT race_date,COUNT(*) AS n,SUM(CASE WHEN grade IS NOT NULL THEN 1 ELSE 0 END) AS graded FROM jra_race_program WHERE race_date BETWEEN ? AND ? GROUP BY race_date ORDER BY race_date`).bind(from,to).all();
  const c=await env.DB.prepare(`SELECT race_date,COUNT(*) AS n,SUM(runner_count) AS runners FROM jra_races WHERE race_date BETWEEN ? AND ? GROUP BY race_date ORDER BY race_date`).bind(from,to).all();
  const byDate={};
  for(const r of p.results||[]) byDate[r.race_date]={date:r.race_date,programRaces:Number(r.n||0),gradedProgramRaces:Number(r.graded||0),raceCardsStored:0,runnersStored:0};
  for(const r of c.results||[]){byDate[r.race_date] ||= {date:r.race_date,programRaces:0,gradedProgramRaces:0,raceCardsStored:0,runnersStored:0};byDate[r.race_date].raceCardsStored=Number(r.n||0);byDate[r.race_date].runnersStored=Number(r.runners||0)}
  return Object.values(byDate).map(x=>({...x,cardCoveragePct:x.programRaces?Math.round(x.raceCardsStored/x.programRaces*1000)/10:0}));
}

async function ingestDay(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date");
  if(!validDate(date)) throw new Error("date=YYYY-MM-DD is required");
  const programs=(await env.DB.prepare(`SELECT race_date,venue,race_no FROM jra_race_program WHERE race_date=? ORDER BY venue,race_no`).bind(date).all()).results||[];
  if(!programs.length) throw new Error("No staged program rows for this date; run meeting-prep first");

  const runs=[];
  for(const p of programs){
    const out=await invoke(u.origin,"/v1/jra/ingest",{date:p.race_date,venue:p.venue,race_no:p.race_no},env,ctx);
    runs.push({venue:p.venue,raceNo:Number(p.race_no),ok:Boolean(out.data?.ok),httpStatus:out.status,runnerCount:Number(out.data?.runnerCount||out.data?.race?.runnerCount||0),stage:out.data?.stage||null,error:out.data?.error||out.data?.reason||null});
  }
  const okRuns=runs.filter(x=>x.ok),runnerTotal=okRuns.reduce((s,x)=>s+x.runnerCount,0);
  return {ok:okRuns.length>0,stage:"all-race-card-ingest",version:"3.7.0",date,programRaceCount:programs.length,attempted:programs.length,storedRaceCards:okRuns.length,storedRunners:runnerTotal,coveragePct:programs.length?Math.round(okRuns.length/programs.length*1000)/10:0,runs,policy:{baseDataset:"all JRA races",heavyAnalysis:"graded plus selected targets",safeBeforePublication:"0% coverage is expected until official race cards are published"}};
}

async function ingestRange(request,env,ctx){
  const u=new URL(request.url),raw=u.searchParams.get("dates"),dates=(raw||"").split(",").map(x=>x.trim()).filter(validDate);
  if(!dates.length) throw new Error("dates=YYYY-MM-DD[,YYYY-MM-DD...] is required");
  if(dates.length>5) throw new Error("maximum 5 dates per request");
  const runs=[];
  for(const date of dates){
    const r=await ingestDay(new Request(`${u.origin}/v1/lab/card-ingest?date=${date}`),env,ctx).catch(e=>({ok:false,stage:"all-race-card-ingest",version:"3.7.0",date,error:String(e),programRaceCount:0,attempted:0,storedRaceCards:0,storedRunners:0,coveragePct:0,runs:[]}));
    runs.push(r);
  }
  return {ok:runs.some(x=>x.ok),stage:"multi-day-all-race-card-ingest",version:"3.7.0",dates,runs,totals:{programRaces:runs.reduce((s,x)=>s+Number(x.programRaceCount||0),0),raceCardsStored:runs.reduce((s,x)=>s+Number(x.storedRaceCards||0),0),runnersStored:runs.reduce((s,x)=>s+Number(x.storedRunners||0),0)}};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/") return json({ok:true,service:"keiba-lab-api",version:"3.7.0",phase:"all-race card ingestion readiness"});
    if(!env.DB) return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(u.pathname==="/v1/lab/card-ingest") return json(await ingestDay(request,env,ctx));
      if(u.pathname==="/v1/lab/card-ingest-range") return json(await ingestRange(request,env,ctx));
      if(u.pathname==="/v1/lab/storage-audit"){
        const from=u.searchParams.get("from")||"2026-10-10",to=u.searchParams.get("to")||from;
        const dates=await audit(env,from,to),totals=dates.reduce((a,x)=>({programRaces:a.programRaces+x.programRaces,gradedProgramRaces:a.gradedProgramRaces+x.gradedProgramRaces,raceCardsStored:a.raceCardsStored+x.raceCardsStored,runnersStored:a.runnersStored+x.runnersStored}),{programRaces:0,gradedProgramRaces:0,raceCardsStored:0,runnersStored:0});
        return json({ok:true,stage:"all-race-storage-audit",version:"3.7.0",from,to,totals,dates,next:totals.raceCardsStored?"Race cards are being accumulated. Keep all-race storage; run heavy analysis only for prioritized targets.":"Program rows are ready. Official race cards have not been stored yet; this is expected before publication."});
      }
      if(u.pathname==="/v1/lab/deploy-check") return json({ok:true,version:"3.7.0",build:"all-race-card-ingestion-readiness",now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.7.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
