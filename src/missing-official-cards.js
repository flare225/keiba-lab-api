import {discoverExpectedCard} from './expected-card-discovery.js';
import {metaFromRacecardUrl} from './index-v1.1.4.js';
import {officialUrl,jstDay} from './history-collection-v3.37.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';

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
 const identity=r=>`official-card:${r.date}:${r.venue}:${r.raceNo}:${r.sourceBasis}`;
 let waiting=[];try{waiting=(await db.prepare('SELECT snapshot_id,next_attempt_at FROM lab_expected_card_discovery WHERE snapshot_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(candidates.map(identity))).all()).results||[]}catch(e){if(!/no such table/.test(String(e)))throw e;}
 const receipts=new Map(waiting.map(r=>[r.snapshot_id,Number(r.next_attempt_at)||0]));
 // A short retry time must not let the first few cards monopolize every
 // history-lane slot. Visit untried cards first, then the oldest due receipt.
 const pick=pool=>pool.find(r=>!receipts.has(identity(r)))||pool.filter(r=>receipts.get(identity(r))<=stamp).sort((a,b)=>receipts.get(identity(a))-receipts.get(identity(b)))[0];
 const urgent=candidates.filter(r=>{const start=Date.parse(`${r.date}T${r.startTime}:00+09:00`);return start>stamp&&start-stamp<=12*3600000});
 const r=pick(urgent)||pick(candidates);if(!r)return{ok:true,status:candidates.length?'card-discovery-not-due':'complete',externalRequests:0};
 let url;try{url=officialUrl(r.sourceUrl);}catch{return{ok:false,status:'missing-program-source',externalRequests:0};}
 const meta=metaFromRacecardUrl(url),targetDate=r.date;
 const source={date:targetDate,venue:r.venue,raceNo:r.raceNo,snapshotId:`official-card:${targetDate}:${r.venue}:${r.raceNo}:${r.sourceBasis}`,officialRosterDiscoveryUrl:url};
 if(meta?.date===targetDate&&meta.venue===r.venue&&meta.raceNo===r.raceNo)source.officialCardUrl=url;
 return{...await (deps.discover||discoverExpectedCard)(db,source,deps),target:{date:targetDate,venue:r.venue,raceNo:r.raceNo},predictionRebuilt:false};
}
