import {EXPECTED_SOURCES,expectedAge} from './expected-runner-preview-v3.30.0.js';
import {discoverExpectedProfiles} from './expected-profile-discovery-v3.47.0.js';
import {readConfirmedPredraw} from './confirmed-predraw-roster.js';
import {completeCollectedTraining} from './history-learning-completion.js';
import {collectionStatus,collectHistoryBatch,officialUrl,jstDay,scheduledCollection} from './history-collection-v3.37.0.js';

// The dated supplementary roster never becomes an official card or a prediction seal.
// Only profile links already published on an age-consistent JRA card may be reused.
async function rows(db,query,args=[]){try{return (await db.prepare(query).bind(...args).all()).results||[];}catch(e){if(/no such table/.test(String(e)))return [];throw e;}}
export function upcomingExpectedSources(now,sources=EXPECTED_SOURCES){const today=jstDay(now),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return sources.filter(s=>s.date>=today&&s.date<=until).sort((a,b)=>(a.priority??100)-(b.priority??100)||a.date.localeCompare(b.date));}
export async function expectedHistoryContext(db,source){
 const confirmed=await readConfirmedPredraw(db,source);
 if(confirmed)return {race:{race_key:'expected:'+source.snapshotId,race_date:source.date,venue:source.venue,race_no:source.raceNo,race_name:source.raceName,source_url:confirmed.source_url,runner_count:confirmed.runners.length},runners:confirmed.runners,rosterBasis:'confirmed-predraw'};
 const runners=source.names.map(horse_name=>({horse_name,age:expectedAge(source,horse_name),horse_no:null}));
 const links=await rows(db,"SELECT l.horse_name,l.profile_url,l.source_url FROM lab_history_profile_links l JOIN jra_races r ON r.race_key=l.race_key JOIN jra_runners x ON x.race_key=r.race_key AND x.horse_name=l.horse_name AND x.age=l.age JOIN json_each(?) e ON json_extract(e.value,'$.horse_name')=x.horse_name WHERE l.source_url=r.source_url AND r.race_date>=printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-CAST(json_extract(e.value,'$.age') AS INTEGER)+2) AND r.race_date<? AND x.age=(CAST(json_extract(e.value,'$.age') AS INTEGER)-(CAST(substr(?,1,4) AS INTEGER)-CAST(substr(r.race_date,1,4) AS INTEGER))) ORDER BY l.checked_at DESC LIMIT 216",[JSON.stringify(runners),source.date,source.date,source.date]);
 if(source.officialHorsePage){const published=await rows(db,'SELECT horse_name,profile_url,source_url,age FROM lab_expected_jra_profile_links WHERE snapshot_id=? AND source_url=?',[source.snapshotId,source.officialHorsePage]);links.push(...published.filter(l=>source.names.includes(l.horse_name)&&Number(l.age)===expectedAge(source,l.horse_name)));}

 const byName=new Map();for(const l of links){try{officialUrl(l.source_url);const url=officialUrl(l.profile_url,true);if(!byName.has(l.horse_name))byName.set(l.horse_name,new Set());byName.get(l.horse_name).add(url);}catch{}}
 return {race:{race_key:'expected:'+source.snapshotId,race_date:source.date,venue:source.venue,race_no:source.raceNo,race_name:source.raceName,source_url:null,runner_count:source.names.length},runners:runners.map(r=>({...r,profile_url:byName.get(r.horse_name)?.size===1?[...byName.get(r.horse_name)][0]:null}))};
}
export async function expectedHistoryStatus(db,now=Date.now(),sources=EXPECTED_SOURCES){
 const races=[];for(const source of upcomingExpectedSources(now,sources)){
  const formalRace=(await rows(db,'SELECT r.* FROM jra_races r WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)',[source.date,source.venue,source.raceNo]))[0];
  const formal=!!formalRace;
  const context=formal?{race:formalRace,runners:await rows(db,'SELECT horse_no,horse_name,age FROM jra_runners WHERE race_key=? ORDER BY horse_no',[formalRace.race_key])}:await expectedHistoryContext(db,source);
  let status;try{status=await collectionStatus(db,{historyLimit:10},now,context);}catch(e){if(!/no such table/.test(String(e)))throw e;status=null;}
  races.push({date:source.date,venue:source.venue,raceNo:source.raceNo,raceName:source.raceName,snapshotId:source.snapshotId,formalCardSaved:formal,rosterBasis:formal?'official-card':context.rosterBasis||'expected-snapshot',available:!!status,runnerCount:context.runners.length,withStoredHistory:status?.runners.filter(r=>r.storedRows>0).length??null,pendingHorses:status?.pendingHorses??null,profileLinksFound:status?status.runners.filter(r=>r.profileUrl).length:context.runners.filter(r=>r.profile_url).length,runners:status?.runners.map(r=>({horseName:r.horseName,storedRows:r.storedRows,last3fRows:r.last3fRows,profileLinkKnown:!!r.profileUrl,collectionState:r.collectionState,due:r.due,lastCheckedAt:r.lastCheckedAt}))||[]});
 }
 return {races,rosterCoverage:'対象の週末レースを表示。全馬分の正式出馬表を保存したレースは正式出走馬、それまでは保存済み想定馬を集計します。全レースの取得完了を示すものではありません。',guardrails:{readOnly:true,externalRequests:0,officialCardsNeverCreated:true,horseNumbersNeverInferred:true,sourcePriority:'JRA',sameGlobalSourceBudget:true}};
}
export async function collectUpcomingExpectedHistory(db,deps={}){
 const now=deps.now||Date.now;
 for(const source of upcomingExpectedSources(now(),deps.sources||EXPECTED_SOURCES)){
  const formal=await rows(db,'SELECT r.race_key FROM jra_races r WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)',[source.date,source.venue,source.raceNo]);
  if(formal.length){
   if(source.priority===0){const r=await collectHistoryBatch(db,{date:source.date,venue:source.venue,raceNo:source.raceNo,historyLimit:10,batchSize:1},deps);if(r.attempted||r.status==='cooldown')return {...r,stage:'main-race-official-history'};}
   continue;
  }
  const confirmed=await readConfirmedPredraw(db,source);
  if(!confirmed){const discovery=await discoverExpectedProfiles(db,source,deps);if(discovery.externalRequests||discovery.status==='cooldown')return discovery;}
  const context=await expectedHistoryContext(db,source);
  const r=await collectHistoryBatch(db,{historyLimit:10,batchSize:1},{...deps,context});
  if(r.attempted||r.status==='cooldown')return {...r,stage:'expected-runner-prior-history',snapshotId:source.snapshotId,authoritativeForCard:false};
 }
 return {ok:true,status:'idle',externalRequests:0};
}
export async function scheduledWeekendHistory(db,deps={}){
 // Reserve alternating nine-minute source slots for past training races.
 // A successful or throttled request ends this invocation; idle lanes fall back.
 const now=deps.now||Date.now;
 if(Math.floor(now()/540000)%2===1){
  const training=await (deps.trainingCollector||scheduledCollection)(db,{...deps,trainingOnly:true});
  if(training.attempted||training.externalRequests||training.status==='cooldown')return completeCollectedTraining(db,{...training,historyLane:'training'},now());
 }
 const expected=await collectUpcomingExpectedHistory(db,deps);
 if(expected.attempted||expected.externalRequests||expected.status==='cooldown')return expected;
 return completeCollectedTraining(db,await scheduledCollection(db,deps),now());
}
