import {discoverExpectedCard,isPublishedCardNavigation} from './expected-card-discovery.js';
import {metaFromMeetingListUrl,metaFromRacecardUrl} from './index-v1.1.4.js';
import {officialUrl,jstDay} from './history-collection-v3.37.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';

// Published JRA link witnessed on 2026-10-22. This is a discovery input,
// never a saved card: runners and numbering must still come from JRA fetch.
const witnessedOfficialCards=[{date:'2026-10-25',venue:'京都',raceNo:11,url:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604091120261025/39'}];
function witnessedUrl(target){
 const link=witnessedOfficialCards.find(x=>x.date===target.date&&x.venue===target.venue&&x.raceNo===target.raceNo);
 if(!link)return null;
 const url=officialUrl(link.url),meta=metaFromRacecardUrl(url);
 if(!meta||meta.date!==target.date||meta.venue!==target.venue||meta.raceNo!==target.raceNo)throw Error('照合済み公式URLの対象が一致しません。');
 return url;
}

export async function missingOfficialCards(db,date,stamp=Date.now(),until=date,target=null){
 targetInput({date,venue:'東京',raceNo:1});
 const exact=target?targetInput({...target,date}):null;
 const scope=exact?'p.race_date=? AND p.venue=? AND p.race_no=?':'p.race_date BETWEEN ? AND ?';
 const bindings=exact?[exact.date,exact.venue,exact.raceNo]:[date,until];
 const rows=(await db.prepare(`SELECT p.race_date,p.venue,p.race_no,p.start_time,p.source_url,(SELECT c.source_url FROM jra_races c WHERE c.race_date=p.race_date AND c.venue=p.venue AND c.runner_count>0 ORDER BY c.race_no LIMIT 1) sibling_url FROM jra_race_program p WHERE ${scope} AND NOT EXISTS(SELECT 1 FROM jra_races r WHERE r.race_date=p.race_date AND r.venue=p.venue AND r.race_no=p.race_no AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key)) ORDER BY p.race_no DESC,p.venue LIMIT 120`).bind(...bindings).all()).results||[];
 const unique=[...new Map(rows.map(r=>[r.race_date+':'+r.venue+':'+r.race_no,r])).values()];
 let gate=null;try{gate=await db.prepare("SELECT next_batch_at FROM lab_history_collection_budget WHERE name='jra-history'").first();}catch(e){if(!/no such table/.test(String(e)))throw e;}
 return{ok:true,date,missing:unique.map(r=>({date:r.race_date,venue:r.venue,raceNo:Number(r.race_no),startTime:r.start_time,sourceUrl:r.sibling_url||r.source_url,sourceBasis:r.sibling_url?'stored-sibling-card':'official-program'})),nextBatchAt:Number(gate?.next_batch_at)>0?new Date(Number(gate.next_batch_at)).toISOString():null,externalRequests:0};
}
export async function collectMissingOfficialCard(db,input={},deps={}){
 const stamp=(deps.now||Date.now)(),date=input.date||jstDay(stamp);
 const specified=input.venue!=null||input.raceNo!=null||input.race_no!=null;
 const target=specified?targetInput({...input,date}):null;
 if(!target)targetInput({date,venue:'東京',raceNo:1});
 let witnessedCard=null;
 if(input.officialCardUrl!=null){
  if(!target)throw Error('公式出馬表URLの指定には対象レースが必要です。');
  witnessedCard=officialUrl(input.officialCardUrl);
  const identity=metaFromRacecardUrl(witnessedCard),u=new URL(witnessedCard);
  if(u.pathname!=='/JRADB/accessD.html'||!identity||identity.date!==target.date||identity.venue!==target.venue||identity.raceNo!==target.raceNo)throw Error('公式出馬表URLの対象が一致しません。');
 }
 let gate;try{gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first()}catch(e){if(!/no such table/.test(String(e)))throw e;}
 const blockedUntil=Math.max(Number(gate?.next_batch_at)||0,Number(gate?.locked_until)||0);
 if(blockedUntil>stamp)return{ok:true,status:'cooldown',externalRequests:0,nextBatchAt:new Date(blockedUntil).toISOString()};
 const until=input.includeFuture?new Date(Date.parse(date+'T00:00:00Z')+7*86400000).toISOString().slice(0,10):date;
 const plan=await missingOfficialCards(db,date,stamp,until,target);
 if(plan.nextBatchAt&&Date.parse(plan.nextBatchAt)>stamp)return{ok:true,status:'cooldown',externalRequests:0,nextBatchAt:plan.nextBatchAt};
 const candidates=plan.missing.filter(r=>(!input.upcomingOnly||(/^\d{2}:\d{2}$/.test(r.startTime||'')&&Date.parse(`${r.date}T${r.startTime}:00+09:00`)>stamp))&&(!specified||(r.date===date&&r.venue===input.venue&&r.raceNo===Number(input.raceNo??input.race_no))));
 // Upcoming cards first. Past cards may be stored, never used to recreate forecasts.
 candidates.sort((a,b)=>{
  const future=r=>/^\d{2}:\d{2}$/.test(r.startTime||'')&&Date.parse(`${r.date}T${r.startTime}:00+09:00`)>stamp;
  return Number(future(b))-Number(future(a))||a.date.localeCompare(b.date)||Number(b.raceNo===11)-Number(a.raceNo===11)||b.raceNo-a.raceNo;
 });
 // Preserve the existing PR257 continuity logic across source-basis changes.
 const receiptIds=r=>['official-program','stored-sibling-card'].map(basis=>`official-card:${r.date}:${r.venue}:${r.raceNo}:${basis}`);
 let waiting=[];try{waiting=(await db.prepare('SELECT snapshot_id,next_attempt_at,card_url,status FROM lab_expected_card_discovery WHERE snapshot_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set([...new Map(candidates.map(r=>[`${r.date}:${r.venue}`,r])).values()].flatMap(r=>Array.from({length:12},(_,i)=>receiptIds({...r,raceNo:i+1})).flat()))])).all()).results||[]}catch(e){if(!/no such table/.test(String(e)))throw e;}
 const receiptById=new Map(waiting.map(row=>[row.snapshot_id,row]));
 const identity=r=>{
  const existing=receiptIds(r).map(id=>receiptById.get(id)).filter(Boolean);
  const active=existing.filter(x=>x.card_url&&['official-card-link-found','official-card-index-found'].includes(x.status));
  const chosen=(active.length?active:existing).sort((a,b)=>Number(b.next_attempt_at)-Number(a.next_attempt_at))[0];
  return chosen?.snapshot_id||`official-card:${r.date}:${r.venue}:${r.raceNo}:${r.sourceBasis}`;
 };
 const receipts=new Map(waiting.map(r=>[r.snapshot_id,Number(r.next_attempt_at)||0]));
 // Both legacy IDs denote one race: preserve the strictest existing retry
 // deadline, even when the URL continuation lives on the older identity.
 for(const r of candidates)if(receiptIds(r).some(id=>receiptById.has(id)))receipts.set(identity(r),Math.max(0,...receiptIds(r).map(id=>Number(receiptById.get(id)?.next_attempt_at)||0)));

 const receiptCards=new Map(waiting.map(r=>[r.snapshot_id,r.card_url]));
 // Ready card and discovery cohorts share the existing source slot. The
 // prior lane comes from the existing coordinator result, never a new clock.
 const linked=new Set(waiting.filter(r=>['official-card-link-found','official-card-index-found'].includes(r.status)&&r.card_url).map(r=>r.snapshot_id));
 const due=r=>!receipts.has(identity(r))||receipts.get(identity(r))<=stamp;
 const lane=r=>{const u=receiptCards.get(identity(r))||witnessedUrl(r)||r.sourceUrl,m=metaFromRacecardUrl(u);return m?.date===r.date&&m.venue===r.venue&&m.raceNo===r.raceNo?'card':'discovery'};
 const pick=pool=>pool.find(r=>!receipts.has(identity(r)))||pool.slice().sort((a,b)=>receipts.get(identity(a))-receipts.get(identity(b)))[0];
 const eligible=candidates.filter(due),urgent=eligible.filter(r=>{const start=Date.parse(`${r.date}T${r.startTime}:00+09:00`);return start>stamp&&start-stamp<=12*3600000});
 const previous=deps.previousCardSelection?.lane;
 const original=pool=>pick(pool.filter(r=>linked.has(identity(r))))||pick(pool);
 // Share discovery turns between untried races and due receipts. Do not let
 // new receipt identities suppress older due races, or retries suppress new ones.
 const previousClass=deps.previousCardSelection?.lastDiscoveryClass;
 const previousRetryStage=deps.previousCardSelection?.lastRetryDiscoveryStage;
 const continuation=r=>isPublishedCardNavigation(receiptCards.get(identity(r)),r);
 const retryPick=pool=>{
  const follow=pool.filter(continuation),search=pool.filter(r=>!continuation(r));
  return previousRetryStage==='continuation'?(pick(search)||pick(follow)):(pick(follow)||pick(search));
 };
 const discoveryPick=pool=>{
  if(!previous&&!previousClass)return original(pool);
  const fresh=pool.filter(r=>!receipts.has(identity(r))),retry=pool.filter(r=>receipts.has(identity(r)));
  return previousClass==='retry'?(pick(fresh)||retryPick(retry)):(retryPick(retry)||pick(fresh));
 };
 const ordinary=pool=>{const r=original(pool);return r&&lane(r)==='discovery'?discoveryPick(pool.filter(x=>lane(x)==='discovery')):r};
 const fair=(pool,urgentOnly=false)=>{const select=urgentOnly?original:ordinary;return ['card','discovery'].includes(previous)?(select(pool.filter(r=>lane(r)!==previous))||select(pool)):select(pool)};
 const witnessed=eligible.filter(r=>witnessedUrl(r)&&!receiptCards.get(identity(r)));
 const r=fair(urgent,true)||pick(witnessed)||fair(eligible);if(!r)return{ok:true,status:candidates.length?'card-discovery-not-due':'complete',externalRequests:0};
 const discoveryClass=lane(r)==='discovery'?(receipts.has(identity(r))?'retry':'untried'):null;
 const retryDiscoveryStage=discoveryClass==='retry'?(continuation(r)?'continuation':'reexploration'):null;
 const selection={lane:lane(r),retryDiscoveryStage,lastRetryDiscoveryStage:retryDiscoveryStage||previousRetryStage||null,previousRetryDiscoveryStage:previousRetryStage||null,lastDiscoveryClass:discoveryClass||previousClass||null,previousDiscoveryClass:previousClass||null,discoveryClass,reason:urgent.includes(r)?'urgent':witnessed.includes(r)?'witnessed-url':'alternate-eligible-cohorts',previousLane:previous||null,target:`${r.date}:${r.venue}:${r.raceNo}`,eligibleCards:eligible.filter(x=>lane(x)==='card').length,eligibleDiscovery:eligible.filter(x=>lane(x)==='discovery').length,eligibleUntriedDiscovery:eligible.filter(x=>lane(x)==='discovery'&&!receipts.has(identity(x))).length,eligibleRetryDiscovery:eligible.filter(x=>lane(x)==='discovery'&&receipts.has(identity(x))).length,eligibleContinuationDiscovery:eligible.filter(x=>lane(x)==='discovery'&&receipts.has(identity(x))&&continuation(x)).length,eligibleReexplorationDiscovery:eligible.filter(x=>lane(x)==='discovery'&&receipts.has(identity(x))&&!continuation(x)).length};
 let url;try{url=witnessedCard||witnessedUrl(r)||officialUrl(r.sourceUrl);}catch{return{ok:false,status:'missing-program-source',externalRequests:0};}
 const meta=metaFromRacecardUrl(url),targetDate=r.date;
 const source={date:targetDate,venue:r.venue,raceNo:r.raceNo,snapshotId:identity(r),officialRosterDiscoveryUrl:url};
 // Reuse a due same-day/same-venue meeting URL from the already-read receipts.
 // No extra SELECT, URL construction, or write.
 const meetingReceipt=waiting.find(row=>{const m=metaFromMeetingListUrl(row.card_url);return m?.date===targetDate&&m.venue===r.venue;});
 if(meetingReceipt)source.officialMeetingListUrl=meetingReceipt.card_url;
 if(meta?.date===targetDate&&meta.venue===r.venue&&meta.raceNo===r.raceNo)source.officialCardUrl=url;
 const result=await (deps.discover||discoverExpectedCard)(db,source,deps);
 return{...result,...(result.externalRequests?{cardSelection:selection}:{}),target:{date:targetDate,venue:r.venue,raceNo:r.raceNo},predictionRebuilt:false};
}
