import {reviewedJraProfiles} from './reviewed-jra-profile-sources.js';
import {readExpectedProfilePage} from './expected-profile-page-discovery.js';
import {storedExpectedSources} from './expected-roster-registry.js';
import {nextConfirmedPredrawSource} from './confirmed-predraw-history-source.js';
import {EXPECTED_SOURCES,expectedAge} from './expected-runner-preview-v3.30.0.js';
import {discoverExpectedProfiles} from './expected-profile-discovery-v3.47.0.js';
import {readConfirmedPredraw} from './confirmed-predraw-roster.js';
import {discoverExpectedCard} from './expected-card-discovery.js';
import {completeCollectedTraining} from './history-learning-completion.js';
import {collectionStatus,collectHistoryBatch,officialUrl,jstDay,scheduledCollection} from './history-collection-v3.37.0.js';
import {markProvisionalHistoryUpdated} from './provisional-prediction-snapshots.js';
import {metaFromRacecardUrl,metaFromMeetingListUrl} from './index-v1.1.4.js';

// The dated supplementary roster never becomes an official card or a prediction seal.
// Reuse age-consistent official card links, or independently reviewed individual
// JRA profiles whose name/birth date are checked again by the bounded collector.
async function rows(db,query,args=[]){try{return (await db.prepare(query).bind(...args).all()).results||[];}catch(e){if(/no such table/.test(String(e)))return [];throw e;}}
export function upcomingExpectedSources(now,sources=EXPECTED_SOURCES){const today=jstDay(now),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return sources.filter(s=>s.date>=today&&s.date<=until).sort((a,b)=>(a.priority??100)-(b.priority??100)||a.date.localeCompare(b.date));}
export async function withStoredRosterDiscovery(db,source){
 if(source.officialRosterDiscoveryUrl||source.officialHorsePage||source.officialRacePage)return source;
 const found=await rows(db,'SELECT source_url FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=? LIMIT 1',[source.date,source.venue,source.raceNo]);
 const value=found[0]?.source_url;if(!value)return source;
 try{
  const u=new URL(officialUrl(value)),m=metaFromRacecardUrl(value)||metaFromMeetingListUrl(value);
  const [year,month,day]=source.date.split('-');
  const calendar=u.pathname===`/keiba/calendar${year}/${year}/${month}/${month}${day}.html`&&!u.search&&!u.hash;
  if(!calendar&&!(m?.date===source.date&&m.venue===source.venue&&(!m.raceNo||m.raceNo===source.raceNo)))return source;
  return {...source,officialRosterDiscoveryUrl:value,...(m?.raceNo?{officialCardUrl:value}:{})};
 }catch{return source;}
}
export async function expectedHistoryContext(db,source,now=Date.now()){
 const confirmed=await readConfirmedPredraw(db,source);
 if(confirmed)return {race:{race_key:'expected:'+source.snapshotId,race_date:source.date,venue:source.venue,race_no:source.raceNo,race_name:source.raceName,source_url:confirmed.source_url,runner_count:confirmed.runners.length},runners:confirmed.runners,rosterBasis:'confirmed-predraw'};
 const runners=source.names.map(horse_name=>({horse_name,age:expectedAge(source,horse_name),horse_no:null}));
 const links=await rows(db,"SELECT l.horse_name,l.profile_url,l.source_url FROM lab_history_profile_links l JOIN jra_races r ON r.race_key=l.race_key JOIN jra_runners x ON x.race_key=r.race_key AND x.horse_name=l.horse_name AND x.age=l.age JOIN json_each(?) e ON json_extract(e.value,'$.horse_name')=x.horse_name WHERE l.source_url=r.source_url AND r.race_date>=printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-CAST(json_extract(e.value,'$.age') AS INTEGER)+2) AND r.race_date<? AND x.age=(CAST(json_extract(e.value,'$.age') AS INTEGER)-(CAST(substr(?,1,4) AS INTEGER)-CAST(substr(r.race_date,1,4) AS INTEGER))) ORDER BY l.checked_at DESC LIMIT 216",[JSON.stringify(runners),source.date,source.date,source.date]);
 const officialHorsePage=await readExpectedProfilePage(db,source);
 if(officialHorsePage){const published=await rows(db,'SELECT horse_name,profile_url,source_url,age FROM lab_expected_jra_profile_links WHERE snapshot_id=? AND source_url=?',[source.snapshotId,officialHorsePage]);links.push(...published.filter(l=>source.names.includes(l.horse_name)&&Number(l.age)===expectedAge(source,l.horse_name)));}

 const reviewed=reviewedJraProfiles(source,undefined,now);
 const byName=new Map();for(const l of links){try{officialUrl(l.source_url);const url=officialUrl(l.profile_url,true);if(!byName.has(l.horse_name))byName.set(l.horse_name,new Set());byName.get(l.horse_name).add(url);}catch{}}
 return {race:{race_key:'expected:'+source.snapshotId,race_date:source.date,venue:source.venue,race_no:source.raceNo,race_name:source.raceName,source_url:null,runner_count:source.names.length},runners:runners.map(r=>{
  const cached=byName.get(r.horse_name),fact=!cached?.size?reviewed.get(r.horse_name):null;
  return {...r,profile_url:cached?.size===1?[...cached][0]:fact?.profileUrl||null,...(fact?{reviewed_profile:fact}:{})};
 })};
}
export async function expectedHistoryStatus(db,now=Date.now(),sources=EXPECTED_SOURCES,includeRegistered=true){
 const today=jstDay(now),since=new Date(Date.parse(today+'T00:00:00Z')-7*86400000).toISOString().slice(0,10);
 const registered=includeRegistered?await storedExpectedSources(db,since,new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10)):[];
 const combined=[...registered,...sources.filter(s=>!registered.some(r=>r.date===s.date&&r.venue===s.venue&&r.raceNo===s.raceNo))];
 const visibleSources=[...combined.filter(s=>s.date>=since&&s.date<today),...upcomingExpectedSources(now,combined)];
 const races=[];for(const source of visibleSources){
  const formalRace=(await rows(db,'SELECT r.* FROM jra_races r WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)',[source.date,source.venue,source.raceNo]))[0];
  const formal=!!formalRace;
  const context=formal?{race:formalRace,runners:await rows(db,'SELECT horse_no,horse_name,age FROM jra_runners WHERE race_key=? ORDER BY horse_no',[formalRace.race_key])}:await expectedHistoryContext(db,source,now);
  let status;try{status=await collectionStatus(db,{historyLimit:3},now,context);}catch(e){if(!/no such table/.test(String(e)))throw e;status=null;}
  races.push({date:source.date,venue:source.venue,raceNo:source.raceNo,raceName:source.raceName,snapshotId:source.snapshotId,formalCardSaved:formal,rosterBasis:formal?'official-card':context.rosterBasis||'expected-snapshot',available:!!status,historyLimit:3,historyLimitMeaning:'stored-row-target-not-lifetime-completeness',runnerCount:context.runners.length,withStoredHistory:status?.runners.filter(r=>r.storedRows>0).length??null,pendingHorses:status?.pendingHorses??null,profileLinksFound:status?status.runners.filter(r=>r.profileUrl).length:context.runners.filter(r=>r.profile_url).length,runners:status?.runners.map(r=>({horseName:r.horseName,storedRows:r.storedRows,last3fRows:r.last3fRows,profileLinkKnown:!!r.profileUrl,collectionState:r.collectionState,collectionError:r.collectionError,nextRetryAt:r.nextRetryAt,due:r.due,lastCheckedAt:r.lastCheckedAt}))||[]});
 }
 return {races,rosterCoverage:'対象の週末レースを表示。全馬分の正式出馬表を保存したレースは正式出走馬、それまでは保存済み想定馬を集計します。全レースの取得完了を示すものではありません。',guardrails:{readOnly:true,externalRequests:0,officialCardsNeverCreated:true,horseNumbersNeverInferred:true,sourcePriority:'JRA',sameGlobalSourceBudget:true}};
}
export async function collectUpcomingExpectedHistory(db,deps={}){
 const now=deps.now||Date.now,discoverySources=[],waiting=[];
 const markReevaluation=async(source,result)=>result.results?.some(item=>Number(item.savedRows)>0)?markProvisionalHistoryUpdated(db,source,now()):0;
 const stamp=now(),day=jstDay(stamp),until=new Date(Date.parse(day+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const registered=deps.sources?[]:await storedExpectedSources(db,day,until);
 const fixed=upcomingExpectedSources(stamp,deps.sources||[...registered,...EXPECTED_SOURCES.filter(s=>!registered.some(r=>r.date===s.date&&r.venue===s.venue&&r.raceNo===s.raceNo))]);
 const discovered=deps.sources?null:await (deps.nextPredrawSource||nextConfirmedPredrawSource)(db,now());
 const sources=discovered&&!fixed.some(s=>s.date===discovered.date&&s.venue===discovered.venue&&s.raceNo===discovered.raceNo)?[...fixed,discovered]:fixed;
 // Use verified cached profiles across all target races before requesting a
 // discovery page. A failing discovery must not repeatedly starve known horses.
 for(const source of sources){
  const formal=await rows(db,'SELECT r.race_key FROM jra_races r WHERE r.race_date=? AND r.venue=? AND r.race_no=? AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)',[source.date,source.venue,source.raceNo]);
  if(formal.length){
   if(source.priority===0||source.snapshotId?.startsWith('registered:')){const r=await collectHistoryBatch(db,{date:source.date,venue:source.venue,raceNo:source.raceNo,historyLimit:3,batchSize:1},deps),provisionalEvaluationQueued=await markReevaluation(source,r);if(r.attempted||r.status==='cooldown')return {...r,stage:'main-race-official-history',provisionalEvaluationQueued};waiting.push({raceKey:source.raceKey,status:r.status,pendingHorses:r.before?.pendingHorses,provisionalEvaluationQueued});}
   continue;
  }
  const context=await expectedHistoryContext(db,source,stamp);
  if(context.rosterBasis!=='confirmed-predraw')discoverySources.push(source);
  const r=await collectHistoryBatch(db,{historyLimit:3,batchSize:1},{...deps,context});
  const provisionalEvaluationQueued=await markReevaluation(source,r);
  if(r.attempted||r.status==='cooldown')return {...r,stage:'expected-runner-prior-history',snapshotId:source.snapshotId,authoritativeForCard:false,provisionalEvaluationQueued};
  waiting.push({raceKey:source.raceKey||`${source.date}:${source.venue}:${source.raceNo}`,snapshotId:source.snapshotId,status:r.status,pendingHorses:r.before?.pendingHorses,missingProfileLinks:r.before?.runners.filter(h=>h.storedRows<3&&!h.profileUrl).map(h=>h.horseName),provisionalEvaluationQueued});
 }
 for(const original of discoverySources){
  const source=await withStoredRosterDiscovery(db,original);
  const card=await discoverExpectedCard(db,source,deps);
  if(card.externalRequests||card.status==='cooldown')return card;
  const discovery=await discoverExpectedProfiles(db,source,deps);
  if(discovery.externalRequests||discovery.status==='cooldown')return discovery;
  waiting.push({snapshotId:source.snapshotId,cardStatus:card.status,profileStatus:discovery.status});
 }
 return {ok:true,status:waiting.length?'awaiting-source-readiness':'idle',waiting,externalRequests:0};
}
export async function scheduledWeekendHistory(db,deps={}){
 // Upcoming target races take precedence; the ordinary queue uses idle slots.
 const now=deps.now||Date.now;
 const expected=await collectUpcomingExpectedHistory(db,deps);
 if(expected.attempted||expected.externalRequests||expected.status==='cooldown')return expected;
 const training=await (deps.trainingCollector||scheduledCollection)(db,deps);
 return completeCollectedTraining(db,{...training,historyLane:'ordinary'},now());
}
