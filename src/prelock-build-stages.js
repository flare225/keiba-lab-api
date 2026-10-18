// Prediction preparation consumes stored history only. External collection owns
// its own shared budget/lease; preparing scores must not start a bulk scraper.
export async function storedHistoryStage(db,{date,venue,raceNo}){
 const race=await db.prepare('SELECT race_key,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,raceNo).first();
 if(!race)return{status:409,data:{ok:false,stage:'stored-history',error:'official-card-not-stored',externalRequests:0}};
 const runners=(await db.prepare(`SELECT r.horse_name,(SELECT COUNT(*) FROM (SELECT 1 FROM jra_past_performances p WHERE p.horse_name=r.horse_name AND p.race_date<? AND p.race_date>=printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-r.age+2) AND p.finish_position>=1 AND p.field_size>=p.finish_position LIMIT 3)) AS stored_rows FROM jra_runners r WHERE r.race_key=? ORDER BY r.horse_no`).bind(date,date,race.race_key).all()).results||[];
 const missing=runners.filter(r=>Number(r.stored_rows)===0).map(r=>r.horse_name);
 const ready=Number(race.runner_count)>0&&runners.length===Number(race.runner_count)&&missing.length===0;
 return{status:ready?200:409,data:{ok:ready,stage:'stored-history',externalRequests:0,runnerCount:runners.length,missingHistoryHorses:missing,collectionTarget:3,shortHistoryHorses:runners.filter(r=>Number(r.stored_rows)<3).map(r=>r.horse_name),error:ready?null:'awaiting-stored-prior-history'}};
}
export async function runPrelockBuildStages(calls,invoke){
 const stages={};let blockedBy=null;
 for(const[name,path,params]of calls){
  if(blockedBy){stages[name]={ok:false,skipped:true,blockedBy};continue;}
  let result;try{result=await invoke(name,path,params)}catch(error){result={status:500,data:{ok:false,error:String(error?.message||error)}};}
  const d=result.data;const ok=result.status<400&&d?.ok===true;
  stages[name]={httpStatus:result.status,ok,version:d?.version||null,stage:d?.stage||null,error:d?.error||null,...(name==='history'?{externalRequests:0,missingHistoryHorses:d?.missingHistoryHorses||[],shortHistoryHorses:d?.shortHistoryHorses||[]}: {})};
  if(!ok)blockedBy=name;
 }
 return{stages,blockedBy};
}
