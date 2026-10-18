import {collectionStatus,collectHistoryBatch,jstDay} from './history-collection-v3.37.0.js';
import {EXPECTED_SOURCES} from './expected-runner-preview-v3.30.0.js';
import {missingRecentHistorySql} from './recent-history-coverage.js';

// Use the existing source slot and collector lease. Dates come from stored
// official cards, so ordinary races need no hand-maintained target roster.
export async function upcomingOfficialHistoryPlan(db,stamp=Date.now(),sources=EXPECTED_SOURCES){
 const today=jstDay(stamp),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const races=(await db.prepare(`WITH coverage AS MATERIALIZED (SELECT r.race_key,r.race_date,r.venue,r.race_no,r.race_name,r.runner_count,p.start_time,p.source_url AS program_source_url,
 ${missingRecentHistorySql('r.race_key','r.race_date')} AS missing_horses
 FROM jra_races r LEFT JOIN jra_race_program p ON p.race_date=r.race_date AND p.venue=r.venue AND p.race_no=r.race_no
 WHERE r.race_date>=? AND r.race_date<=? AND r.runner_count>0
 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)
 ) SELECT * FROM coverage WHERE missing_horses>0
 ORDER BY race_date,race_no DESC,venue LIMIT 120`).bind(today,until).all()).results||[];
 const targets=new Set(sources.filter(s=>s.priority===0).map(s=>s.raceKey||`${s.date}:${s.venue}:${s.raceNo}`));
 return races.filter(r=>{
  if(r.race_date>today)return true;
  let official=false;try{const u=new URL(r.program_source_url);official=u.protocol==='https:'&&['jra.go.jp','www.jra.go.jp','jra.jp','www.jra.jp'].includes(u.hostname)}catch{}
  const cutoff=/^\d{2}:\d{2}$/.test(r.start_time||'')?Date.parse(`${today}T${r.start_time}:00+09:00`)-300000:NaN;
  return official&&Number.isFinite(cutoff)&&stamp<cutoff;
 }).sort((a,b)=>a.race_date.localeCompare(b.race_date)||Number(targets.has(b.race_key))-Number(targets.has(a.race_key))||b.race_no-a.race_no||a.venue.localeCompare(b.venue))
 .map(r=>({raceKey:r.race_key,date:r.race_date,venue:r.venue,raceNo:r.race_no,raceName:r.race_name,missingHorses:Number(r.missing_horses),targetMain:targets.has(r.race_key)}));
}
export async function collectUpcomingOfficialHistory(db,{now=Date.now,plan=upcomingOfficialHistoryPlan,status=collectionStatus,collect=collectHistoryBatch}={}){
 const stamp=now(),all=await plan(db,stamp),today=jstDay(stamp);
 const current=all.filter(r=>r.date===today),queue=current.length?current:all;
 // Always check the most urgent card; rotate five other cards so unknown
 // profiles in the first few races cannot starve the remainder of the week.
 const rest=queue.slice(1),offset=rest.length?(Math.floor(stamp/360000)*5)%rest.length:0;
 const window=queue.length?[queue[0],...rest.slice(offset),...rest.slice(0,offset)].slice(0,6):[];
 for(const race of window){
  const input={date:race.date,venue:race.venue,raceNo:race.raceNo,historyLimit:3,batchSize:1};
  const coverage=await status(db,input,stamp);
  if(!coverage.runners.some(r=>r.storedRows<3&&r.due))continue;
  return {...await collect(db,input,{now}),stage:'upcoming-official-missing-history',priorityRaceKey:race.raceKey};
 }
 return current.length?{ok:true,status:'awaiting-today-history',externalRequests:0,missingRaces:current.length}:null;
}
