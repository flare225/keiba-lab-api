import {ensureCollectionTables,officialUrl} from './history-collection-v3.37.0.js';
import {extractLinks} from './index-v1.1.4.js';
export async function readExpectedProfilePage(db,source){
 if(source.officialHorsePage)return source.officialHorsePage;
 if(!source.officialRacePage)return null;
 try{const row=await db.prepare('SELECT page_url FROM lab_expected_profile_pages WHERE snapshot_id=? AND source_url=?').bind(source.snapshotId,source.officialRacePage).first();return row?.page_url||null}catch(e){if(/no such table/.test(String(e)))return null;throw e;}
}
export async function discoverExpectedProfilePage(db,source,deps={}){
 if(!source.officialRacePage)return{ok:true,status:'not-configured',externalRequests:0};
 const stamp=(deps.now||Date.now)(),url=officialUrl(source.officialRacePage),parsed=new URL(url);
 if(!/^\/keiba\/race\/\d{3}\.html$/.test(parsed.pathname)||parsed.search)throw Error('公式レース情報ページの形式が不正です。');
 await ensureCollectionTables(db);await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_profile_pages(snapshot_id TEXT PRIMARY KEY,source_url TEXT NOT NULL,page_url TEXT,next_attempt_at INTEGER NOT NULL)').run();
 const old=await db.prepare('SELECT * FROM lab_expected_profile_pages WHERE snapshot_id=?').bind(source.snapshotId).first();
 if(old?.source_url===url&&Number(old.next_attempt_at)>stamp)return{ok:true,status:'profile-page-discovery-not-due',externalRequests:0};
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return{ok:true,status:'cooldown',externalRequests:0};
 let pause=60000;
 try{
 const response=await(deps.fetcher||fetch)(url,{headers:{accept:'text/html'},redirect:'follow',signal:AbortSignal.timeout(10000)});
 if(!response.ok){if([403,429,503].includes(response.status))pause=3600000;throw Error('JRA取得 HTTP '+response.status)}
 if(response.url&&response.url!==url)throw Error('公式レース情報の転送先が一致しません。');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('公式ページのサイズ上限');
 const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
 const wanted=parsed.pathname.replace(/\.html$/,'/horse.html');
 const links=extractLinks(html,url).filter(v=>{try{const u=new URL(v);return u.origin===parsed.origin&&u.pathname===wanted&&!u.search&&!u.hash}catch{return false}});
 const page=links[0]||null;
 await db.prepare('INSERT OR REPLACE INTO lab_expected_profile_pages VALUES(?,?,?,?)').bind(source.snapshotId,url,page,stamp+(page?86400000:3600000)).run();
 if(page){const saved=await readExpectedProfilePage(db,source);if(saved!==page)throw Error('公開リンクをDBで読み返せません。');}
 return{ok:!!page,status:page?'profile-page-discovered':'profile-page-not-published-in-fetched-source',externalRequests:1,pageUrl:page,profileLinksFound:0,historyRowsSaved:0};
 }catch(e){await db.prepare('INSERT OR REPLACE INTO lab_expected_profile_pages VALUES(?,?,NULL,?)').bind(source.snapshotId,url,stamp+3600000).run();return{ok:false,status:'failed',externalRequests:1,error:String(e.message||e)};}
 finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind((deps.now||Date.now)()+pause,token).run();}
}
