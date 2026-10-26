import {resolveReviewedWithdrawal,hasReviewedWithdrawal} from './reviewed-withdrawal-card.js';
// Opt-in shared acquisition. Activation requires explicit configuration and
// separately approved store initialization; existing deployments stay disabled.
// Network is injected explicitly; one delivery can fetch at most one page.
import {extractLinks,metaFromMeetingListUrl,metaFromRacecardUrl} from './index-v1.1.4.js';
import {inspectSourceCard,runnerFingerprint,sha256} from './card-evidence.js';
import {saveConfirmedPredraw} from './confirmed-predraw-roster.js';
import {saveDrawnOfficialCard,isPublishedCardNavigation,cardDiscoveryFailureEvidence} from './expected-card-discovery.js';
import {jraPageRequest,isJraSourceBlocked} from './jra-page-request.js';
import {observedQuotaPause} from './scheduled-read-budget.js';

export const SHARED_PAGE_POLICY=Object.freeze({maxRaces:120,maxPages:256,maxDepth:4,maxLinks:256,maxBytes:1500000,maxStoredBodyBytes:16*1024*1024,maxVersionsPerPage:4,refreshMs:3600000,maxWaitMs:6*3600000,parserVersion:'shared-page-v3-predraw-preparation'});
const PAGES='lab_shared_page_receipts_v1',BODIES='lab_shared_page_bodies_v1';
const quota=e=>e?.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e));
const key=r=>`${r.date}:${r.venue}:${r.raceNo}`;
const day=stamp=>new Date(stamp+9*3600000).toISOString().slice(0,10);
export function canonicalPublishedPage(value){
 const u=new URL(value);
 if(u.origin!=='https://www.jra.go.jp'||u.username||u.password)throw Error('Non-JRA page');
 const calendar=/^\/keiba\/calendar\d{4}\/\d{4}\/\d{1,2}\/\d{4}\.html$/.test(u.pathname)&&!u.search;
 const action=u.pathname==='/JRADB/accessD.html'&&u.searchParams.size===1&&u.searchParams.has('CNAME')&&/^pw01d[a-z0-9]+\/[a-z0-9]+$/i.test(u.searchParams.get('CNAME')||'')&&u.search.length<=300;
 if(!calendar&&!action)throw Error('Unsupported published page');
 u.hash='';u.searchParams.sort();return u.href;
}
export function parseSharedPage(html,url){
 // Keep the existing 256 acquisition-page bound; CSS/general navigation are not jobs.
 const links=new Set();
 for(const link of extractLinks(html,url)){try{links.add(canonicalPublishedPage(link));}catch{continue;}if(links.size>SHARED_PAGE_POLICY.maxLinks)throw Error('Published-link bound exceeded');}
 const pages=[],cards=[];
 for(const canonical of links){
  const meta=metaFromRacecardUrl(canonical);
  if(meta){if(!meta.venue||meta.raceNo<1||meta.raceNo>12)continue;cards.push({...meta,url:canonical});}
  else if(new URL(canonical).pathname==='/JRADB/accessD.html')pages.push(canonical);
 }
 return{pages:[...new Set(pages)],cards};
}
// Explicit store setup, never implicitly invoked from cron.
export async function initializeSharedPageStore(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${PAGES}(scope_key TEXT NOT NULL,page_url TEXT NOT NULL,status TEXT NOT NULL,next_at INTEGER NOT NULL,body_sha TEXT,findings_json TEXT,parser_version TEXT,observed_at INTEGER,last_attempt_at INTEGER,error TEXT,card_key TEXT,card_result_json TEXT,PRIMARY KEY(scope_key,page_url))`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${BODIES}(scope_key TEXT NOT NULL,page_url TEXT NOT NULL,sha256 TEXT NOT NULL,body_html TEXT NOT NULL,byte_length INTEGER NOT NULL,observed_at INTEGER NOT NULL,http_status INTEGER NOT NULL DEFAULT 200,charset TEXT NOT NULL DEFAULT 'utf-8',received_bytes INTEGER,PRIMARY KEY(scope_key,page_url,sha256))`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS shared_body_no_${action.toLowerCase()} BEFORE ${action} ON ${BODIES} BEGIN SELECT RAISE(ABORT,'Shared source body is immutable'); END`).run();
}
function validateInventory(races,scope,stamp){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(scope)||!races.length||races.length>SHARED_PAGE_POLICY.maxRaces)throw Error('Bounded week scope required');
 const scopeDay=Date.parse(scope+'T00:00:00Z');if(!Number.isFinite(scopeDay))throw Error('Invalid scope');
 const result=races.map(r=>{
  const start=Date.parse(r.startAt),enqueued=Date.parse(r.enqueuedAt),date=Date.parse(r.date+'T00:00:00Z');
  if(!['東京','京都','新潟','札幌','函館','福島','中山','中京','阪神','小倉'].includes(r.venue)||!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>12||!Number.isFinite(start)||day(start)!==r.date||!Number.isFinite(enqueued)||enqueued>stamp||date<scopeDay||date>scopeDay+7*86400000)throw Error('Invalid race identity/deadline');
  const rootUrl=canonicalPublishedPage(r.rootUrl),u=new URL(rootUrl);
  if(u.pathname.includes('/keiba/calendar')&&!u.pathname.endsWith('/'+r.date.slice(5).replace('-','')+'.html'))throw Error('Calendar date mismatch');
  if(r.cardUrl){const m=metaFromRacecardUrl(canonicalPublishedPage(r.cardUrl));if(!m||key(m)!==key(r))throw Error('Explicit card identity mismatch');}
  return{...r,rootUrl,start,enqueued};
 });
 if(new Set(result.map(key)).size!==result.length)throw Error('Duplicate race identity');return result;
}
function findings(row){return row?.findings_json?JSON.parse(row.findings_json):null;}
export function planSharedPages(races,rows,stamp,parserVersion=SHARED_PAGE_POLICY.parserVersion,{allowStartedCards=false,completionPriorityRaceKeys=[]}={}){
 const completionOrder=new Map(completionPriorityRaceKeys.map((k,i)=>[k,i]));
 const records=new Map(rows.map(r=>[r.page_url,r])),known=new Map(),meetings=new Map(),jobs=new Map();let complete=0,waiting=0;
 for(const row of rows){const f=findings(row);if(row.status!=='parsed'||!f||row.parser_version!==parserVersion)continue;
  for(const page of f.pages||[]){const meeting=metaFromMeetingListUrl(page);if(meeting)meetings.set(`${meeting.date}:${meeting.venue}`,canonicalPublishedPage(page));}
  for(const card of f.cards||[]){const old=known.get(key(card));if(!old||Number(card.detailed)>Number(old.detailed))known.set(key(card),card);}
 }
 const add=(url,race,depth)=>{const old=jobs.get(url);if(old)old.races.push(race);else jobs.set(url,{url,races:[race],depth,row:records.get(url)});};
 for(const race of races){if(race.formalSaved||(!allowStartedCards&&race.start<=stamp+300000)){complete+=Number(!!race.formalSaved);continue;}
  const card=race.cardUrl||known.get(key(race))?.url;
  const queue=[{url:card||meetings.get(`${race.date}:${race.venue}`)||race.rootUrl,depth:0}],seen=new Set(),refresh=[];let found=false;
  while(queue.length){const {url,depth}=queue.shift();if(seen.has(url)||depth>SHARED_PAGE_POLICY.maxDepth)continue;seen.add(url);
   const row=records.get(url);
   if(row?.status==='formal-saved'&&row.card_key===key(race)){complete++;found=true;break;}
   if(Number(row?.next_at)>stamp)continue;
   const parsedCard=row?.status==='parsed'&&key(metaFromRacecardUrl(url)||{})===key(race);
   const cached=row?.body_sha&&(parsedCard||row.status==='body-stored'||row.parser_version!==parserVersion||row.status==='card-ready'||(row.status==='parse-failed'&&hasReviewedWithdrawal(race,stamp)));
   if(cached){add(url,race,depth);found=true;break;}
   if(row?.status==='parse-failed'&&row.parser_version===parserVersion)continue;
   if(!row?.body_sha){add(url,race,depth);found=true;break;}
   const f=findings(row);if(f?.kind==='predraw')continue;
   for(const child of f?.pages||[]){const meeting=metaFromMeetingListUrl(child);if(meeting&&(meeting.date!==race.date||meeting.venue!==race.venue))continue;queue.push({url:child,depth:depth+1});}
   if(stamp-Number(row.observed_at)>=SHARED_PAGE_POLICY.refreshMs)refresh.push({url,depth});
  }
  if(!found&&refresh.length){const fallback=refresh.sort((a,b)=>b.depth-a.depth)[0];add(fallback.url,race,fallback.depth);found=true;}
  if(!found)waiting++;
 }
 const priority=job=>{
  const upcoming=job.races.map(r=>r.start).filter(start=>start>stamp+300000);
  const start=upcoming.length?Math.min(...upcoming):Math.min(...job.races.map(r=>r.start));
  const urgent=upcoming.length>0&&start-stamp<=12*3600000;
  const pastOnly=upcoming.length===0;
  const since=Number(job.row?.last_attempt_at)||Math.min(...job.races.map(r=>r.enqueued));
  const focus=pastOnly?Math.min(...job.races.map(r=>completionOrder.get(key(r))??completionOrder.size)):0;
  return[pastOnly?2:urgent?0:1,focus,urgent?start:Math.min(start,since+SHARED_PAGE_POLICY.maxWaitMs),start,job.url];
 };
 const compare=(a,b)=>{const x=priority(a),y=priority(b);for(let i=0;i<x.length;i++){if(x[i]!==y[i])return typeof x[i]==='number'?x[i]-y[i]:x[i].localeCompare(y[i]);}return 0;};
 return{jobs:[...jobs.values()].sort(compare),complete,waiting};
}
async function readBody(db,scope,url,row){
 const body=await db.prepare(`SELECT body_html,byte_length,http_status FROM ${BODIES} WHERE scope_key=? AND page_url=? AND sha256=?`).bind(scope,url,row.body_sha).first();
 if(!body||new TextEncoder().encode(body.body_html).length!==body.byte_length||await sha256(body.body_html)!==row.body_sha)throw Error('Saved shared body hash mismatch');return body;
}
async function updateReceipt(db,scope,url,state){
 await db.prepare(`INSERT INTO ${PAGES}(scope_key,page_url,status,next_at,body_sha,findings_json,parser_version,observed_at,last_attempt_at,error,card_key,card_result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_key,page_url) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,body_sha=excluded.body_sha,findings_json=excluded.findings_json,parser_version=excluded.parser_version,observed_at=excluded.observed_at,last_attempt_at=excluded.last_attempt_at,error=excluded.error,card_key=excluded.card_key,card_result_json=excluded.card_result_json`).bind(scope,url,state.status,state.next_at??0,state.body_sha??null,state.findings_json??null,state.parser_version??null,state.observed_at??null,state.last_attempt_at??null,state.error??null,state.card_key??null,state.card_result_json??null).run();
}
async function parseStored(db,scope,job,row,stamp,deps){
 const body=await readBody(db,scope,job.url,row),html=body.body_html,meta=metaFromRacecardUrl(job.url),version=deps.parserVersion||SHARED_PAGE_POLICY.parserVersion;
 // A published sibling card can be the navigation root for another race.
 // Parse its literal links only; never save that sibling as the selected race.
 const navigationRoot=meta&&job.races.every(r=>r.rootUrl===job.url&&key(r)!==key(meta));
 if(!meta||navigationRoot){
  try{const data=(deps.parser||parseSharedPage)(html,job.url);await updateReceipt(db,scope,job.url,{...row,status:'parsed',next_at:0,parser_version:version,findings_json:JSON.stringify(data),error:null});return{status:'page-parsed',discoveredCards:data.cards.length,discoveredPages:data.pages.length};}
  catch(e){await updateReceipt(db,scope,job.url,{...row,status:'parse-failed',next_at:0,parser_version:version,error:String(e.message||e)});throw e;}
 }
 const race=job.races.find(r=>key(r)===key(meta));if(!race)throw Error('Card target identity mismatch');
 if(!deps.allowStartedCards&&(deps.now||Date.now)()>=race.start-300000)return{status:'deadline-passed',formalCardSaved:false,predictionRebuilt:false};
 const text=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' '),parts=race.date.split('-').map(Number);
 if(!text.includes(`${parts[0]}年${parts[1]}月${parts[2]}日`)||!text.includes(race.venue)||!new RegExp(`alt=["']${race.raceNo}レース["']`).test(html))throw Error('Card source header mismatch');
 const inspect=resolveReviewedWithdrawal((deps.inspectSourceCard||inspectSourceCard)(html),race,stamp);let result;
 if(inspect.allHorseNumbersObserved||inspect.numberSourcesVerified){
  const existing=await db.prepare('SELECT race_key,fetched_at FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(race.date,race.venue,race.raceNo).first();
  if(existing){
   const evidence=await db.prepare('SELECT * FROM lab_card_source_evidence WHERE race_key=?').bind(existing.race_key).first(),saved=(await db.prepare('SELECT * FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(existing.race_key).all()).results||[];
   const fingerprint=await sha256(runnerFingerprint(saved)),sourceFingerprint=await sha256(runnerFingerprint(inspect.raw.map(r=>({...r,frameNo:inspect.frames.get(r.horseNo)}))));
   if(!evidence||evidence.source_url!==job.url||evidence.source_sha256!==row.body_sha||evidence.card_fetched_at!==existing.fetched_at||evidence.runner_sha256!==fingerprint||fingerprint!==sourceFingerprint||saved.length!==inspect.declaredCount||saved.some((r,i)=>r.jockey!==inspect.raw[i].jockey||r.assigned_weight!==inspect.raw[i].assignedWeight||r.age!==inspect.raw[i].age||r.sex!==inspect.raw[i].sex))throw Error('Existing official card requires verification-only; refusing evidence rewrite');
   result={kind:'formal',raceKey:existing.race_key,runnerCount:saved.length,fetchedAt:existing.fetched_at,runnerSha256:fingerprint,newlySaved:false};
  }else{
  // Existing strict source-number/frame validator and existing card writer.
  const card=await saveDrawnOfficialCard(db,html,job.url,body.http_status,race,Number(row.observed_at),deps);
  result={...card,kind:'formal',runnerSha256:await sha256(runnerFingerprint(inspect.raw.map(r=>({...r,frameNo:inspect.frames.get(r.horseNo)}))))};
  }
 }else{try{if(inspect.cancelledRows?.length){const error=Error('正式出馬表の取消・除外馬の馬番が原典に表示されていません。番号を推測せず保存を保留します: '+inspect.cancelledRows.map(r=>r.horseName||'不明').join('、'));error.cancelledCardUnresolved=true;throw error;}const roster=await saveConfirmedPredraw(db,html,job.url,race,{allowUnassignedConnections:true,observedAt:new Date(Number(row.observed_at)).toISOString()});result={kind:'predraw',raceKey:roster.raceKey,runnerCount:roster.runners.length};}catch(e){e.failureEvidence=await cardDiscoveryFailureEvidence(html,job.url,race,{httpStatus:body.http_status,observedAt:new Date(Number(row.observed_at)).toISOString()});throw e;}}
 await updateReceipt(db,scope,job.url,{...row,status:result.kind==='formal'?'formal-saved':'predraw',next_at:stamp+86400000,parser_version:version,findings_json:JSON.stringify({kind:result.kind,pages:[],cards:[]}),card_key:key(race),card_result_json:JSON.stringify(result),error:null});
 return{status:result.kind==='formal'?(result.newlySaved===false?'existing-card-reconciled':'official-card-saved'):'predraw-page-preserved',formalCardSaved:result.kind==='formal'&&result.newlySaved!==false,card:result,predictionRebuilt:false};
}
export async function runSharedPageStep(db,{scope,races},deps={}){
 const stamp=(deps.now||Date.now)();if(typeof deps.fetcher!=='function')throw Error('Shared acquisition requires explicit fetcher');
 const inventory=validateInventory(races,scope,stamp),pause=observedQuotaPause(db,stamp);if(pause)return{...pause,externalRequests:0};
 const gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first();
 if(!gate)return{status:'shared-gate-unavailable',externalRequests:0};
 const blocked=Math.max(Number(gate.next_batch_at)||0,Number(gate.locked_until)||0);if(blocked>stamp)return{status:'cooldown',nextBatchAt:new Date(blocked).toISOString(),externalRequests:0};
 // Opt-in natural initialization only after the unchanged quota/shared gate.
 // No standalone writer or direct production SQL route is introduced.
 if(deps.initializeStore===true)await initializeSharedPageStore(db);
 // Planning never needs saved card-result payloads, errors or old findings
 // attached to an unparsed replacement body. Keep those in the receipt only.
 const rows=(await db.prepare(`SELECT page_url,status,next_at,body_sha,CASE WHEN status='parsed' THEN findings_json ELSE NULL END findings_json,parser_version,observed_at,last_attempt_at,card_key FROM ${PAGES} WHERE scope_key=? ORDER BY page_url LIMIT ?`).bind(scope,SHARED_PAGE_POLICY.maxPages+1).all()).results||[];
 if(rows.length>SHARED_PAGE_POLICY.maxPages)return{status:'page-bound-reached',externalRequests:0};
 const plan=planSharedPages(inventory,rows,stamp,deps.parserVersion,{allowStartedCards:deps.allowStartedCards===true,completionPriorityRaceKeys:deps.completionPriorityRaceKeys});let job=plan.jobs[0];
 if(!job)return{status:plan.complete===inventory.length?'complete':'awaiting-source-or-deadline',completeRaces:plan.complete,waitingRaces:plan.waiting,externalRequests:0};
 const isCached=j=>j.row?.body_sha&&((j.row.status==='parsed'&&j.races.some(r=>key(metaFromRacecardUrl(j.url)||{})===key(r)))||j.row.status==='body-stored'||j.row.status==='card-ready'||(j.row.status==='parse-failed'&&j.races.some(r=>hasReviewedWithdrawal(r,stamp)))||j.row.parser_version!==(deps.parserVersion||SHARED_PAGE_POLICY.parserVersion));let cached=isCached(job);
 if(rows.length===SHARED_PAGE_POLICY.maxPages&&!job.row)return{status:'page-bound-reached',externalRequests:0};
 if(!cached){const storage=await db.prepare(`SELECT COALESCE(SUM(bytes),0) bytes,COALESCE(json_group_object(page_url,versions),'{}') versions_json FROM (SELECT page_url,COUNT(*) versions,SUM(byte_length) bytes FROM ${BODIES} WHERE scope_key=? GROUP BY page_url)`).bind(scope).first(),versions=JSON.parse(storage.versions_json);
  const space=Number(storage.bytes)+SHARED_PAGE_POLICY.maxBytes<=SHARED_PAGE_POLICY.maxStoredBodyBytes;
  job=plan.jobs.find(j=>isCached(j)||(space&&Number(versions[j.url]||0)<SHARED_PAGE_POLICY.maxVersionsPerPage));
  if(!job)return{status:'source-storage-budget',externalRequests:0,scopeBytes:Number(storage.bytes)};cached=isCached(job);}
 if(cached&&!metaFromRacecardUrl(job.url)){try{return{...await parseStored(db,scope,job,job.row,stamp,deps),sourceUrl:job.url,externalRequests:0,reusedBody:true,dependentRaces:job.races.map(key)};}catch(e){if(quota(e))throw e;return{status:'cached-stage-failed',error:String(e.message||e),sourceUrl:job.url,externalRequests:0,saveMayHaveSucceeded:!!e.saveMayHaveSucceeded};}}
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return{status:'lease-unavailable',externalRequests:0};
 let delay=60000,quotaStopped=false,externalRequests=0,stored=!!cached;
 try{
  if(cached)return{...await parseStored(db,scope,job,job.row,stamp,deps),sourceUrl:job.url,externalRequests:0,reusedBody:true,dependentRaces:job.races.map(key)};
  const request=jraPageRequest(job.url);externalRequests=1;const response=await deps.fetcher(request.url,request.options);
  if(!response.ok){if(isJraSourceBlocked(response.status))delay=3600000;throw Error('JRA取得 HTTP '+response.status);}
  if(response.url){const a=new URL(response.url),b=new URL(job.url);if(a.origin!==b.origin||a.pathname!==b.pathname||(a.searchParams.has('CNAME')&&a.searchParams.get('CNAME')!==b.searchParams.get('CNAME')))throw Error('Unexpected source redirect');}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>SHARED_PAGE_POLICY.maxBytes)throw Error('Page byte bound exceeded');
  const charset=/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis',html=new TextDecoder(charset).decode(bytes),hash=await sha256(html),size=new TextEncoder().encode(html).length;
  if(size>SHARED_PAGE_POLICY.maxBytes)throw Error('Decoded page byte bound exceeded');
  const bodyInsert=db.prepare(`INSERT OR IGNORE INTO ${BODIES} VALUES(?,?,?,?,?,?,?,?,?)`).bind(scope,job.url,hash,html,size,stamp,response.status,charset,bytes.byteLength);
  const receipt=db.prepare(`INSERT INTO ${PAGES}(scope_key,page_url,status,next_at,body_sha,observed_at,last_attempt_at) VALUES(?,?,'body-stored',0,?,?,?) ON CONFLICT(scope_key,page_url) DO UPDATE SET status='body-stored',next_at=0,body_sha=excluded.body_sha,observed_at=excluded.observed_at,last_attempt_at=excluded.last_attempt_at,error=NULL`).bind(scope,job.url,hash,stamp,stamp);
  try{await db.batch([bodyInsert,receipt]);stored=true;}catch(e){e.saveMayHaveSucceeded=true;throw e;}
  const row={status:'body-stored',body_sha:hash,observed_at:stamp,last_attempt_at:stamp};
  return{...await parseStored(db,scope,job,row,stamp,deps),sourceUrl:job.url,bodySha256:hash,externalRequests,httpStatus:response.status,dependentRaces:job.races.map(key)};
 }catch(e){if(quota(e)){quotaStopped=true;throw e;}
  if(stored&&metaFromRacecardUrl(job.url)){const latest=await db.prepare(`SELECT * FROM ${PAGES} WHERE scope_key=? AND page_url=?`).bind(scope,job.url).first();await updateReceipt(db,scope,job.url,{...latest,status:e.cancelledCardUnresolved?'parse-failed':'card-ready',next_at:e.cancelledCardUnresolved?0:stamp+3600000,...(e.cancelledCardUnresolved?{parser_version:deps.parserVersion||SHARED_PAGE_POLICY.parserVersion}:{}),error:String(e.message||e)});}
  if(!stored&&!e.saveMayHaveSucceeded)await updateReceipt(db,scope,job.url,{...job.row,status:'http-or-source-failed',next_at:stamp+3600000,last_attempt_at:stamp,error:String(e.message||e)});
  return{status:'deferred',sourceUrl:job.url,error:String(e.message||e),externalRequests,bodyStored:stored,dependentRaces:job.races.map(key),...(e.failureEvidence?{failureEvidence:e.failureEvidence}:{}),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded};
 }finally{if(!quotaStopped)await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind((deps.now||Date.now)()+delay,token).run();}
}

// Local connection seam: the existing collector owns candidate selection.
// Only its exact selected race enters this step; saved page findings remain
// shared across all later selections. No production entry point enables it.
export function createSharedSelectedCardDiscoverer({scope,races},dependencies={}){
 return async(db,source,delivery={})=>{
  const matches=races.filter(r=>key(r)===key(source));
  if(matches.length!==1)throw Error('Selected race requires one existing inventory identity');
  const race=matches[0],receipt=source.discoveryReceipt;
  if(source.officialMeetingListUrl){const m=metaFromMeetingListUrl(source.officialMeetingListUrl);if(!m||m.date!==race.date||m.venue!==race.venue)throw Error('Shared meeting URL identity mismatch');}
  let rootUrl=source.officialRosterDiscoveryUrl,cardUrl=source.officialCardUrl;
  if(!rootUrl)throw Error('Selected race requires a published navigation URL');
  // Reuse the receipt already read by the existing candidate selector. Do not
  // query it again or restart a published continuation from the calendar.
  if(receipt){
   if(!source.snapshotId||receipt.snapshot_id!==source.snapshotId)throw Error('Discovery receipt identity mismatch');
   if(receipt.card_url){
    const saved=canonicalPublishedPage(receipt.card_url),meta=metaFromRacecardUrl(saved);
    if(meta){if(key(meta)!==key(race))throw Error('Discovery receipt card identity mismatch');cardUrl=saved;}
    else if(isPublishedCardNavigation(saved,race)){rootUrl=saved;cardUrl=undefined;}
    else throw Error('Discovery receipt navigation identity is unverified');
   }
   const stamp=(delivery.now||dependencies.now||Date.now)();
   if(Number(receipt.next_attempt_at)>stamp)return{ok:true,status:'card-discovery-not-due',externalRequests:0,nextAttemptAt:new Date(Number(receipt.next_attempt_at)).toISOString()};
  }
  if(source.officialMeetingListUrl&&!cardUrl&&!metaFromMeetingListUrl(rootUrl))rootUrl=canonicalPublishedPage(source.officialMeetingListUrl);
  const result=await runSharedPageStep(db,{scope,races:[{...race,rootUrl,cardUrl:cardUrl||undefined}]},{...dependencies,...delivery});
  const attempted=!!(result.externalRequests||result.reusedBody||result.bodyStored);
  return{...result,attempted,ok:!result.error,target:{date:race.date,venue:race.venue,raceNo:race.raceNo},officialCardsCreated:!!result.formalCardSaved};
 };
}

// Existing natural source coordinator connection. The selected race metadata
// and receipt are reused; no second inventory or legacy receipt read is added.
export async function discoverSharedSelectedCard(db,source,delivery={}){
 const stamp=(delivery.now||Date.now)();
 const race={date:source.date,venue:source.venue,raceNo:source.raceNo,startAt:source.startAt,enqueuedAt:new Date(stamp).toISOString(),rootUrl:source.officialRosterDiscoveryUrl};
 const options={fetcher:(...args)=>globalThis.fetch(...args),initializeStore:true,allowStartedCards:true,...delivery};
 if(!source.sharedInventory)return createSharedSelectedCardDiscoverer({scope:source.date,races:[race]},options)(db,source,delivery);
 const inventory=source.sharedInventory.map(r=>({...r,enqueuedAt:new Date(stamp).toISOString()}));
 const result=await runSharedPageStep(db,{scope:source.date,races:inventory},options);
 const actual=inventory.find(r=>key(r)===(result.card?.raceKey||result.dependentRaces?.[0]))||inventory.find(r=>key(r)===key(source));
 if(!actual)throw Error('Shared page result has no due race identity');
 const attempted=!!(result.externalRequests||result.reusedBody||result.bodyStored||result.waitingRaces);
 const completionPriorityApplied=(options.completionPriorityRaceKeys||[]).includes(key(actual))&&Date.parse(actual.startAt)<=stamp+300000;
 return{...result,attempted,ok:!result.error,target:{date:actual.date,venue:actual.venue,raceNo:actual.raceNo},officialCardsCreated:!!result.formalCardSaved,...(attempted?{cardSelection:{...delivery.previousCardSelection,lane:metaFromRacecardUrl(result.sourceUrl||actual.cardUrl||actual.rootUrl)?'card':'discovery',reason:completionPriorityApplied?'shared-page-completion-priority':'shared-page-deadline',target:key(actual),eligibleSharedRaces:inventory.length,completionPriorityApplied,completionPriorityRaceKeys:options.completionPriorityRaceKeys||[]}}:{})};
}
discoverSharedSelectedCard.acceptsDueInventory=true;
