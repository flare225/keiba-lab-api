import app from "./index-v3.3.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function round1(v){return Math.round(Number(v||0)*10)/10}
function jstDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

async function scanCandidates(env){
  const today=jstDate();
  const q=await env.DB.prepare(`
    SELECT r.race_key,r.race_date,r.venue,r.race_no,r.race_name,r.surface,r.distance,r.runner_count,
      (SELECT COUNT(*) FROM jra_runners rr WHERE rr.race_key=r.race_key) AS stored_runners,
      (SELECT COUNT(*) FROM lab_race_outcomes o WHERE o.race_key=r.race_key AND o.finish_position IS NOT NULL) AS outcome_count,
      (SELECT COUNT(*) FROM lab_model_locks ml WHERE ml.race_key=r.race_key AND ml.model_version='3.3.0-prospective') AS prospective_lock_count
    FROM jra_races r
    WHERE r.race_date>=?
    ORDER BY r.race_date ASC,
      CASE WHEN r.race_no=11 THEN 0 WHEN r.race_no=10 THEN 1 ELSE 2 END,
      r.venue ASC,r.race_no ASC
    LIMIT 80
  `).bind(today).all();
  const races=(q.results||[]).map(r=>{
    const runnerCount=Number(r.runner_count||0),storedRunners=Number(r.stored_runners||0),outcomeCount=Number(r.outcome_count||0),lockCount=Number(r.prospective_lock_count||0);
    const cardComplete=runnerCount>0&&storedRunners===runnerCount;
    const futureDay=r.race_date>today;
    const sameDay=r.race_date===today;
    const eligible=cardComplete&&outcomeCount===0&&lockCount===0&&futureDay;
    const operationalSameDayEligible=cardComplete&&outcomeCount===0&&lockCount===0&&sameDay;
    return{
      raceKey:r.race_key,date:r.race_date,venue:r.venue,raceNo:Number(r.race_no),raceName:r.race_name,surface:r.surface,distance:Number(r.distance||0),
      runnerCount,storedRunners,cardCoveragePct:runnerCount?round1(storedRunners/runnerCount*100):0,
      outcomeCount,alreadyProspectiveLocked:lockCount>0,futureDay,sameDay,
      strictProspectiveEligible:eligible,operationalSameDayEligible,
      blocker:eligible?null:!cardComplete?"race-card-incomplete":outcomeCount>0?"outcomes-already-exist":lockCount>0?"already-sealed":sameDay?"same-day-not-strict-future-holdout":"not-future"
    };
  });
  const strict=races.filter(x=>x.strictProspectiveEligible);
  const sameDay=races.filter(x=>x.operationalSameDayEligible);
  return{
    ok:true,stage:"prospective-candidate-scan",version:"3.3.1",todayJst:today,
    raceCount:races.length,strictEligibleCount:strict.length,sameDayOperationalCount:sameDay.length,
    recommendedStrictCandidates:strict.slice(0,12),sameDayOperationalCandidates:sameDay.slice(0,12),races,
    policy:{strictHoldout:"race_date must be later than today, complete race card, zero official outcomes, and no existing prospective lock",sameDay:"can be sealed operationally, but does not earn strict future-day holdout credit without stored post time"},
    next:strict.length?"Seal one of recommendedStrictCandidates with /v1/lab/full-boost?...&step=7":"No strict future candidate is stored yet. Ingest the next future race card first, then rescan."
  };
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.3.1",phase:"prospective candidate discovery"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(u.pathname==="/v1/lab/prospective-candidates")return json(await scanCandidates(env));
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.3.1",build:"prospective-candidate-scanner",todayJst:jstDate(),now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.3.1",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
