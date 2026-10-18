import {ensureCollectionTables,officialUrl} from './history-collection-v3.37.0.js';
import {extractLinks,metaFromRacecardUrl,parseRace} from './index-v1.1.4.js';
import {saveConfirmedPredraw} from './confirmed-predraw-roster.js';
import {jraPageRequest,isJraSourceBlocked} from './jra-page-request.js';
import {persistFullDay} from './index.js';
import {ensureEvidenceTable,inspectSourceCard,runnerFingerprint,sha256} from './card-evidence.js';

async function saveDrawnOfficialCard(db,html,url,responseStatus,source,stamp,deps){
 const inspect=(deps.inspectSourceCard||inspectSourceCard)(html);
 const race=(deps.parseRace||parseRace)({ok:true,status:responseStatus,url,body:html},source.date,source.venue,Number(source.raceNo));
 if(!inspect.allHorseNumbersObserved||!inspect.allFramesObserved||inspect.sourceRowCount!==race.runnerCount||inspect.declaredCount!==race.runnerCount||race.runnerCount<1||race.runnerCount>18||race.runners.length!==race.runnerCount||new Set(race.runners.map(r=>r.name)).size!==race.runnerCount||race.runners.some((r,i)=>r.horseNo!==i+1||!r.name))throw Error('Drawn official card failed runner/frame verification');
 race.runners=race.runners.map(r=>({...r,frameNo:inspect.frames.get(r.horseNo)}));

 const raceKey=`${source.date}:${source.venue}:${source.raceNo}`;
 const existing=await db.prepare('SELECT race_key,runner_count,fetched_at FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(source.date,source.venue,Number(source.raceNo)).first();
 let fetchedAt;
 if(existing){
  const stored=(await db.prepare('SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(existing.race_key).all()).results||[];
  const same=Number(existing.runner_count)===race.runnerCount&&stored.length===race.runnerCount&&stored.every((r,i)=>Number(r.horse_no)===race.runners[i].horseNo&&Number(r.frame_no)===race.runners[i].frameNo&&r.horse_name===race.runners[i].name);
  if(!same)throw Error('Existing official card differs; refusing to overwrite it');
  fetchedAt=existing.fetched_at;
 }else{
  const persist=deps.persistFullDay||persistFullDay;
  const saved=await persist(db,{date:source.date,races:[race]});
  const row=(saved.saved||[]).find(x=>x.raceKey===raceKey&&x.status==='saved'&&Number(x.runnerCount)===race.runnerCount);
  if(!row)throw Error('Drawn official card save was not confirmed');
  const current=await db.prepare('SELECT fetched_at FROM jra_races WHERE race_key=?').bind(raceKey).first();
  if(!current?.fetched_at)throw Error('Drawn official card readback failed');
  fetchedAt=current.fetched_at;
 }
 await ensureEvidenceTable(db);
 await db.prepare('INSERT INTO lab_card_source_evidence (race_key,source_url,source_sha256,runner_sha256,declared_count,source_row_count,parsed_count,horse_numbers_observed,frames_observed,card_fetched_at,verified_at,count_basis) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET source_url=excluded.source_url,source_sha256=excluded.source_sha256,runner_sha256=excluded.runner_sha256,declared_count=excluded.declared_count,source_row_count=excluded.source_row_count,parsed_count=excluded.parsed_count,horse_numbers_observed=excluded.horse_numbers_observed,frames_observed=excluded.frames_observed,card_fetched_at=excluded.card_fetched_at,verified_at=excluded.verified_at,count_basis=excluded.count_basis')
  .bind(raceKey,url,await sha256(html),await sha256(runnerFingerprint(race.runners)),race.runnerCount,inspect.sourceRowCount,race.runnerCount,1,1,fetchedAt,new Date(stamp).toISOString(),inspect.countBasis).run();
 await db.prepare("INSERT OR IGNORE INTO lab_history_collection_targets (race_key,date,venue,race_no,history_limit,status) VALUES (?,?,?,?,10,'pending')").bind(raceKey,source.date,source.venue,Number(source.raceNo)).run();
 return {raceKey,runnerCount:race.runnerCount,fetchedAt};
}
// Follow only published links. Each delivery fetches one page under the shared lease.
export async function discoverExpectedCard(db,source,deps={}){
 if(source.officialCardUrl){const meta=metaFromRacecardUrl(officialUrl(source.officialCardUrl));if(!meta||meta.date!==source.date||meta.venue!==source.venue||meta.raceNo!==Number(source.raceNo))throw Error('公式出馬表リンクの対象が一致しません。');}
 if(!source.officialRosterDiscoveryUrl)return {ok:true,status:'not-configured',externalRequests:0};
 const now=deps.now||Date.now,stamp=now();await ensureCollectionTables(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,card_url TEXT,next_attempt_at INTEGER NOT NULL,status TEXT,error TEXT)').run();
 const previous=await db.prepare('SELECT * FROM lab_expected_card_discovery WHERE snapshot_id=?').bind(source.snapshotId).first();
 if(Number(previous?.next_attempt_at)>stamp)return {ok:true,status:'card-discovery-not-due',externalRequests:0};
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return {ok:true,status:'cooldown',externalRequests:0};
 let pause=60000,next=stamp+3600000,card=previous?.card_url||source.officialCardUrl||null,status='failed',error=null;
 try{
  const url=officialUrl(card||source.officialRosterDiscoveryUrl);
  if(card){const identity=metaFromRacecardUrl(url);if(!identity||identity.date!==source.date||identity.venue!==source.venue||identity.raceNo!==Number(source.raceNo))throw Error('公式出馬表リンクの対象レースが一致しません。');}
  const request=jraPageRequest(url),response=await (deps.fetcher||fetch)(request.url,request.options);
  if(!response.ok){if(isJraSourceBlocked(response.status))pause=3600000;throw Error('JRA取得 HTTP '+response.status);}
  if(response.url){const resolved=new URL(officialUrl(response.url)),expected=new URL(url);if(resolved.origin!==expected.origin||resolved.pathname!==expected.pathname||(resolved.searchParams.has('CNAME')&&resolved.searchParams.get('CNAME')!==expected.searchParams.get('CNAME')))throw Error('公式名簿の転送先が一致しません。');}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('ページサイズ上限です。');
  const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
  if(card){
   const evidence=(deps.inspectSourceCard||inspectSourceCard)(html);
   if(evidence.allHorseNumbersObserved){
    const formal=await saveDrawnOfficialCard(db,html,url,response.status,source,stamp,deps);status='official-card-saved';next=stamp+86400000;
    return {ok:true,status,formalCardSaved:true,raceKey:formal.raceKey,runnerCount:formal.runnerCount,externalRequests:1,officialCardsCreated:true,source:'JRA'};
   }
   const roster=await saveConfirmedPredraw(db,html,card,source,{allowUnassignedConnections:true});status='confirmed-predraw-saved';next=stamp+86400000;
   return {ok:true,status,confirmedRunners:roster.runners.length,externalRequests:1,officialCardsCreated:false};
  }
  const links=extractLinks(html,url).map(link=>{try{officialUrl(link);return metaFromRacecardUrl(link)}catch{return null}}).filter(m=>m?.date===source.date&&m.venue===source.venue&&m.raceNo===source.raceNo).sort((a,b)=>Number(b.detailed)-Number(a.detailed));
  if(!links.length)throw Error('対象レースの公式出馬表リンクをまだ確認できません。');
  card=links[0].url;status='official-card-link-found';next=stamp+60000;
  return {ok:true,status,externalRequests:1,officialCardsCreated:false};
 }catch(e){error=String(e.message||e);return {ok:false,status,externalRequests:1,error};}
 finally{
  await db.prepare('INSERT OR REPLACE INTO lab_expected_card_discovery VALUES(?,?,?,?,?)').bind(source.snapshotId,card,next,status,error).run();
  await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+pause,token).run();
 }
}
