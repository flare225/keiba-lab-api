async function all(db,sql,args=[]){try{return((await db.prepare(sql).bind(...args).all()).results||[])}catch{return[]}}
const n=v=>v==null?null:Number(v);
const round=(v,d=2)=>v==null?null:Number(Number(v).toFixed(d));

export async function historicalEvidenceForHorse(db,{horseName,beforeDate,limit=8}){
 const rows=await all(db,`SELECT r.race_date,r.venue,r.race_no,r.race_name,o.finish_position,d.finish_status,d.time_seconds,d.corner_positions,d.last3f,d.popularity,d.odds,d.body_weight,d.jockey,d.assigned_weight
 FROM jra_runners x
 JOIN jra_races r ON r.race_key=x.race_key
 LEFT JOIN lab_race_outcomes o ON o.race_key=x.race_key AND o.horse_no=x.horse_no
 LEFT JOIN lab_race_result_details d ON d.race_key=x.race_key AND d.horse_no=x.horse_no
 WHERE x.horse_name=? AND r.race_date<?
 ORDER BY r.race_date DESC,r.race_no DESC LIMIT ?`,[horseName,beforeDate,Math.max(1,Math.min(20,Number(limit)||8))]);
 const finished=rows.filter(x=>Number.isInteger(n(x.finish_position))&&n(x.finish_position)>0);
 const rich=rows.filter(x=>x.last3f!=null||x.time_seconds!=null||x.corner_positions!=null);
 const top3=finished.filter(x=>n(x.finish_position)<=3).length,wins=finished.filter(x=>n(x.finish_position)===1).length;
 const avgFinish=finished.length?round(finished.reduce((s,x)=>s+n(x.finish_position),0)/finished.length):null;
 const last3fs=rich.map(x=>n(x.last3f)).filter(Number.isFinite);
 return{
  horseName,beforeDate,antiLeakageRule:'race_date < target_date',
  summary:{storedStarts:rows.length,finishedStarts:finished.length,wins,top3,top3Rate:finished.length?round(top3/finished.length*100,1):null,avgFinish,richResultStarts:rich.length,avgLast3f:last3fs.length?round(last3fs.reduce((a,b)=>a+b,0)/last3fs.length,2):null},
  recent:rows.map(x=>({date:x.race_date,venue:x.venue,raceNo:n(x.race_no),raceName:x.race_name,finish:n(x.finish_position),finishStatus:x.finish_status||null,timeSeconds:n(x.time_seconds),cornerPositions:x.corner_positions||null,last3f:n(x.last3f),popularity:n(x.popularity),odds:n(x.odds),bodyWeight:n(x.body_weight),jockey:x.jockey||null,assignedWeight:n(x.assigned_weight),richResultAvailable:Boolean(x.last3f!=null||x.time_seconds!=null||x.corner_positions!=null)}))
 };
}

export async function historicalEvidenceForMarked(db,{targetDate,marked,limit=8}){
 const out=[];
 for(const h of marked||[]){
  if(!h?.horseName)continue;
  out.push(await historicalEvidenceForHorse(db,{horseName:h.horseName,beforeDate:targetDate,limit}));
 }
 return out;
}
