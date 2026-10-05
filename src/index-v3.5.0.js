import app from "./index-v3.4.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function jstDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
function addDays(date,days){const d=new Date(`${date}T00:00:00+09:00`);d.setUTCDate(d.getUTCDate()+days);return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href),env,ctx);let data;try{data=await r.json()}catch{data={ok:false,error:`non-json response ${r.status}`}}return{status:r.status,data}}

async function prepDates(request,env,ctx){
  const u=new URL(request.url);
  const raw=u.searchParams.get("dates");
  const dates=(raw?raw.split(","):Array.from({length:8},(_,i)=>addDays(jstDate(),i))).map(x=>x.trim()).filter(validDate);
  if(!dates.length)throw new Error("dates must contain YYYY-MM-DD values");
  if(dates.length>14)throw new Error("maximum 14 dates per request");
  const runs=[];
  for(const date of dates){
    const r=await invoke(u.origin,"/v1/lab/program-stage",{date},env,ctx);
    runs.push({date,httpStatus:r.status,ok:Boolean(r.data?.ok),raceCount:Number(r.data?.raceCount||0),gradedCount:Number(r.data?.gradedCount||0),nonGradedCount:Number(r.data?.nonGradedCount||0),venues:r.data?.venueSummary||[],error:r.data?.error||null});
  }
  const successful=runs.filter(x=>x.ok);
  const totalRaces=successful.reduce((s,x)=>s+x.raceCount,0),graded=successful.reduce((s,x)=>s+x.gradedCount,0),nonGraded=successful.reduce((s,x)=>s+x.nonGradedCount,0);
  return{ok:successful.length>0,stage:"multi-day-all-race-program-prep",version:"3.5.0",requestedDates:dates,successfulDates:successful.length,totalProgramRaces:totalRaces,gradedRaces:graded,nonGradedRaces:nonGraded,nonGradedSharePct:totalRaces?Math.round(nonGraded/totalRaces*1000)/10:0,runs,policy:{rawProgramStorage:"ALL official JRA races",gradedOnly:false,featurePriority:"graded and explicitly selected races get expensive analysis first",prospectiveValidation:"selected targets only; this never limits base-data accumulation"},next:"When official race cards are published, ingest complete cards for every race on the meeting day; seal prospective locks only for selected validation targets."};
}

async function audit(env,from,to){
  if(!validDate(from)||!validDate(to))throw new Error("from/to must be YYYY-MM-DD");
  const program=await env.DB.prepare(`SELECT race_date,COUNT(*) AS races,SUM(CASE WHEN grade IS NOT NULL THEN 1 ELSE 0 END) AS graded FROM jra_race_program WHERE race_date BETWEEN ? AND ? GROUP BY race_date ORDER BY race_date`).bind(from,to).all();
  const cards=await env.DB.prepare(`SELECT race_date,COUNT(*) AS races,SUM(runner_count) AS declared_runners FROM jra_races WHERE race_date BETWEEN ? AND ? GROUP BY race_date ORDER BY race_date`).bind(from,to).all();
  const runners=await env.DB.prepare(`SELECT r.race_date,COUNT(*) AS stored_runners FROM jra_runners rr JOIN jra_races r ON r.race_key=rr.race_key WHERE r.race_date BETWEEN ? AND ? GROUP BY r.race_date ORDER BY r.race_date`).bind(from,to).all();
  const byDate=new Map();
  for(const x of program.results||[])byDate.set(x.race_date,{date:x.race_date,programRaces:Number(x.races||0),gradedProgramRaces:Number(x.graded||0),raceCardsStored:0,declaredRunners:0,runnersStored:0});
  for(const x of cards.results||[]){const d=byDate.get(x.race_date)||{date:x.race_date,programRaces:0,gradedProgramRaces:0,raceCardsStored:0,declaredRunners:0,runnersStored:0};d.raceCardsStored=Number(x.races||0);d.declaredRunners=Number(x.declared_runners||0);byDate.set(x.race_date,d)}
  for(const x of runners.results||[]){const d=byDate.get(x.race_date)||{date:x.race_date,programRaces:0,gradedProgramRaces:0,raceCardsStored:0,declaredRunners:0,runnersStored:0};d.runnersStored=Number(x.stored_runners||0);byDate.set(x.race_date,d)}
  const dates=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,cardCoveragePct:d.programRaces?Math.round(d.raceCardsStored/d.programRaces*1000)/10:0,runnerCoveragePct:d.declaredRunners?Math.round(d.runnersStored/d.declaredRunners*1000)/10:0}));
  const totals=dates.reduce((a,d)=>({programRaces:a.programRaces+d.programRaces,gradedProgramRaces:a.gradedProgramRaces+d.gradedProgramRaces,raceCardsStored:a.raceCardsStored+d.raceCardsStored,declaredRunners:a.declaredRunners+d.declaredRunners,runnersStored:a.runnersStored+d.runnersStored}),{programRaces:0,gradedProgramRaces:0,raceCardsStored:0,declaredRunners:0,runnersStored:0});
  return{ok:true,stage:"all-race-storage-audit",version:"3.5.0",from,to,totals,dates,interpretation:{programLayer:"calendar/program data for all races",raceCardLayer:"official runner cards after publication",historyLayer:"horse histories feed features regardless of whether the source race was graded",heavyAnalysisLayer:"selective by design to control cost"}};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.5.0",phase:"all-race multi-day accumulation"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(u.pathname==="/v1/lab/meeting-prep")return json(await prepDates(request,env,ctx));
      if(u.pathname==="/v1/lab/storage-audit")return json(await audit(env,u.searchParams.get("from")||jstDate(),u.searchParams.get("to")||addDays(jstDate(),14)));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.5.0",build:"all-race-multi-day-accumulation",todayJst:jstDate(),now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.5.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      const origin="https://keiba-lab-api.internal";
      const dates=Array.from({length:8},(_,i)=>addDays(jstDate(),i)).join(",");
      try{await prepDates(new Request(`${origin}/v1/lab/meeting-prep?dates=${encodeURIComponent(dates)}`),env,ctx)}catch(error){console.error("meeting prep failed",String(error))}
    })());
  }
};
