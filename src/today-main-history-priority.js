import {EXPECTED_SOURCES} from './expected-runner-preview-v3.30.0.js';
import {collectionStatus,collectHistoryBatch,jstDay} from './history-collection-v3.37.0.js';

// Reserve an existing source slot for missing race-day histories before optional
// prior-result enrichment. The collector still owns the shared lease/cooldown.
export async function collectTodayMainHistory(db,{now=Date.now,sources=EXPECTED_SOURCES,status=collectionStatus,collect=collectHistoryBatch}={}){
 const stamp=now(),today=jstDay(stamp);
 for(const source of sources.filter(s=>s.date===today&&s.priority===0&&s.raceNo===11)){
  const program=await db.prepare('SELECT p.start_time,p.source_url FROM jra_race_program p JOIN jra_races r ON r.race_date=p.race_date AND r.venue=p.venue AND r.race_no=p.race_no WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND r.runner_count>0').bind(source.date,source.venue,source.raceNo).first();
  if(!/^\d{2}:\d{2}$/.test(program?.start_time||''))continue;
  let official=false;try{const u=new URL(program.source_url);official=u.protocol==='https:'&&['jra.go.jp','www.jra.go.jp','jra.jp','www.jra.jp'].includes(u.hostname)}catch{}
  const cutoff=Date.parse(today+'T'+program.start_time+':00+09:00')-300000;
  if(!official||!Number.isFinite(cutoff)||stamp>=cutoff)continue;
  const input={date:source.date,venue:source.venue,raceNo:source.raceNo,historyLimit:10,batchSize:1};
  const coverage=await status(db,input,stamp);
  if(!coverage.runners.some(r=>r.storedRows===0&&r.due))continue;
  return {...await collect(db,input,{now}),stage:'race-day-missing-history',priorityRaceKey:coverage.race.raceKey};
 }
 return null;
}
