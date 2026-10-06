import {ensureCollectionTables,officialUrl} from './history-collection-v3.37.0.js';
import {expectedAge} from './expected-runner-preview-v3.30.0.js';
import {extractProfileLinks} from './collection-profile-parser-v3.32.0.js';
import {parsePrecardHorsePage} from './precard-context-v3.8.5.js';
export async function discoverExpectedProfiles(db,source,deps={}){
 if(!source.officialHorsePage)return {ok:true,status:'not-configured',externalRequests:0};
 const now=deps.now||Date.now,stamp=now(),url=officialUrl(source.officialHorsePage);
 await ensureCollectionTables(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_jra_profile_links(snapshot_id TEXT,horse_name TEXT,age INTEGER,profile_url TEXT,source_url TEXT,checked_at INTEGER,PRIMARY KEY(snapshot_id,horse_name))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_profile_discovery(snapshot_id TEXT PRIMARY KEY,checked_at INTEGER,next_attempt_at INTEGER,status TEXT,error TEXT)').run();
 const previous=await db.prepare('SELECT next_attempt_at FROM lab_expected_profile_discovery WHERE snapshot_id=?').bind(source.snapshotId).first();
 if(Number(previous?.next_attempt_at)>stamp)return {ok:true,status:'discovery-not-due',externalRequests:0};
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return {ok:true,status:'cooldown',externalRequests:0};
 let pause=60000,next=stamp+86400000;
 try{
  const response=await (deps.fetcher||fetch)(url,{headers:{'user-agent':'KEIBA-LABO bounded official expected-profile discovery',accept:'text/html'},signal:AbortSignal.timeout(10000),redirect:'follow'});
  if(response.url&&response.url!==url)throw Error('JRA出走馬情報の取得元が変更されています。');
  if(!response.ok){if([429,503].includes(response.status))pause=3600000;throw Error('JRA取得 HTTP '+response.status);}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('ページサイズが上限を超えました。');
  const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
  const parsed=parsePrecardHorsePage(html,{expectedDate:source.date,expectedRaceName:source.raceName});
  if(!parsed.published)throw Error('JRA出走馬情報の公開・馬情報を確認できません。');
  const horses=parsed.horses.filter(h=>source.names.includes(h.name)&&h.age===expectedAge(source,h.name));
  const links=extractProfileLinks(html,horses.map(h=>h.name),url),valid=horses.filter(h=>links.has(h.name));
  if(!valid.length)throw Error('JRAプロフィールリンクを確認できません。');
  await db.batch(valid.map(h=>db.prepare('INSERT INTO lab_expected_jra_profile_links VALUES(?,?,?,?,?,?) ON CONFLICT(snapshot_id,horse_name) DO UPDATE SET age=excluded.age,profile_url=excluded.profile_url,source_url=excluded.source_url,checked_at=excluded.checked_at').bind(source.snapshotId,h.name,h.age,officialUrl(links.get(h.name),true),url,now())));
  await db.prepare('INSERT OR REPLACE INTO lab_expected_profile_discovery VALUES(?,?,?,?,?)').bind(source.snapshotId,now(),next,'checked',null).run();
  return {ok:true,status:'discovered',stage:'expected-official-profile-discovery',snapshotId:source.snapshotId,profileLinksFound:valid.length,externalRequests:1,officialCardsCreated:false};
 }catch(e){next=now()+3600000;await db.prepare('INSERT OR REPLACE INTO lab_expected_profile_discovery VALUES(?,?,?,?,?)').bind(source.snapshotId,now(),next,'failed',String(e.message||e)).run();return {ok:false,status:'failed',externalRequests:1,error:String(e.message||e)};
 }finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+pause,token).run();}
}
