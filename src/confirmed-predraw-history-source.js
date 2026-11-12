import {storedExpectedSources} from './expected-roster-registry.js';
import {metaFromRacecardUrl} from './index-v1.1.4.js';
import {officialUrl,jstDay} from './history-collection-v3.37.0.js';

// Bridge parser-verified JRA pre-draw rosters into the existing one-horse
// collector. This creates neither an official numbered card nor a prediction.
export async function nextConfirmedPredrawSource(db,stamp=Date.now()){
 const today=jstDay(stamp),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_predraw_history_dispatch(race_key TEXT PRIMARY KEY,considered_at INTEGER NOT NULL)').run();
 let rows;try{rows=(await db.prepare(`SELECT r.*,COALESCE(d.considered_at,0) considered_at FROM lab_confirmed_predraw_rosters r LEFT JOIN lab_predraw_history_dispatch d ON d.race_key=r.race_key WHERE substr(r.race_key,1,10) BETWEEN ? AND ? ORDER BY COALESCE(d.considered_at,0),r.race_key LIMIT 120`).bind(today,until).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return null;throw e;}
 for(const row of rows){
  const source=confirmedPredrawSource(row,stamp);if(!source)continue;
  await db.prepare('INSERT INTO lab_predraw_history_dispatch VALUES(?,?) ON CONFLICT(race_key) DO UPDATE SET considered_at=excluded.considered_at').bind(row.race_key,stamp).run();
  return source;
 }
 return null;
}

export function confirmedPredrawSource(row,stamp){
  let source;try{
   const meta=metaFromRacecardUrl(officialUrl(row.source_url));
   if(!meta||`${meta.date}:${meta.venue}:${meta.raceNo}`!==row.race_key||!/^https:\/\/www\.jra\.go\.jp\/JRADB\/accessD\.html\?/.test(row.source_url)||!/^[a-f0-9]{64}$/.test(row.source_sha256)||!Number.isFinite(Date.parse(row.checked_at))||Date.parse(row.checked_at)>stamp)return null;
   const runners=JSON.parse(row.runners_json);
   if(!Array.isArray(runners)||!runners.length||runners.length>18||new Set(runners.map(r=>r.horse_name)).size!==runners.length||runners.some(r=>typeof r.horse_name!=='string'||!r.horse_name.trim()||!Number.isInteger(r.age)||r.age<2||r.age>15||r.horse_no!=null||r.frame_no!=null))return null;
   for(const r of runners)officialUrl(r.profile_url,true);
   source={date:meta.date,venue:meta.venue,raceNo:meta.raceNo,raceName:'公式枠順確定前名簿',snapshotId:'confirmed-predraw:'+row.race_key,names:runners.map(r=>r.horse_name),priority:50,rosterBasis:'confirmed-predraw',provider:'JRA',kind:'confirmed-predraw',confirmationVerified:true,sourceUrl:row.source_url,observedAt:row.checked_at,ages:Object.fromEntries(runners.map(r=>[r.horse_name,r.age]))};
  }catch{return null;}
 return {...source,basis:'confirmed-predraw',sourceSha256:row.source_sha256};
}

// Reuse validated stored inputs; one bounded indexed READ, no source/dispatch write.
export async function storedProvisionalSources(db,from,to,stamp=Date.now()){
 const registered=await storedExpectedSources(db,from,to);let rows=[];
 try{rows=(await db.prepare('SELECT * FROM lab_confirmed_predraw_rosters WHERE race_key>=? AND race_key<? ORDER BY race_key LIMIT 120').bind(from+':',to+';').all()).results||[];}catch(e){if(!/no such table/i.test(String(e)))throw e;}
 return [...rows.map(r=>confirmedPredrawSource(r,stamp)).filter(Boolean),...registered];
}
