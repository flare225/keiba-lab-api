import {ensureCollectionTables,officialUrl} from './history-collection-v3.37.0.js';
import {extractLinks,metaFromRacecardUrl} from './index-v1.1.4.js';
import {saveConfirmedPredraw} from './confirmed-predraw-roster.js';
import {jraPageRequest,isJraSourceBlocked} from './jra-page-request.js';
// Follow only published links. Each delivery fetches one page under the shared lease.
export async function discoverExpectedCard(db,source,deps={}){
 if(!source.officialRosterDiscoveryUrl)return {ok:true,status:'not-configured',externalRequests:0};
 const now=deps.now||Date.now,stamp=now();await ensureCollectionTables(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_card_discovery(snapshot_id TEXT PRIMARY KEY,card_url TEXT,next_attempt_at INTEGER NOT NULL,status TEXT,error TEXT)').run();
 const previous=await db.prepare('SELECT * FROM lab_expected_card_discovery WHERE snapshot_id=?').bind(source.snapshotId).first();
 if(Number(previous?.next_attempt_at)>stamp)return {ok:true,status:'card-discovery-not-due',externalRequests:0};
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return {ok:true,status:'cooldown',externalRequests:0};
 let pause=60000,next=stamp+3600000,card=previous?.card_url||null,status='failed',error=null;
 try{
  const url=officialUrl(card||source.officialRosterDiscoveryUrl),request=jraPageRequest(url),response=await (deps.fetcher||fetch)(request.url,request.options);
  if(!response.ok){if(isJraSourceBlocked(response.status))pause=3600000;throw Error('JRA取得 HTTP '+response.status);}
  if(response.url){const resolved=new URL(officialUrl(response.url)),expected=new URL(url);if(resolved.origin!==expected.origin||resolved.pathname!==expected.pathname||(resolved.searchParams.has('CNAME')&&resolved.searchParams.get('CNAME')!==expected.searchParams.get('CNAME')))throw Error('公式名簿の転送先が一致しません。');}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('ページサイズ上限です。');
  const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
  if(card){
   const roster=await saveConfirmedPredraw(db,html,card,source);status='confirmed-predraw-saved';next=stamp+86400000;
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
