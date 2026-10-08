import {missingPriorHistorySql} from './learning-history-priority.js';
import {parsePastPerformances,extractProfileLinks,ensureHistoryTable} from './collection-profile-parser-v3.32.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {storedHistoryResultSource,resultProfileLinks} from './history-result-profile-source.js';
export const COLLECTION_POLICY={version:'bounded-jra-profile-v1',concurrency:1,maxHorsesPerBatch:2,maxExternalRequestsPerBatch:3,minRequestGapMs:5000,minBatchGapMs:60000,futureRefreshMs:86400000,archiveFromDate:'2016-01-01',scheduledHorsesPerRun:2,sourcePriority:'JRA',targetDateExcluded:true,preserveExistingRichFields:true,profileLinkCache:true,scheduledRunsPerHour:6};
const integer=(v,defaultValue,min,max)=>Number.isInteger(Number(v))?Math.max(min,Math.min(max,Number(v))):defaultValue;
const dayOffset=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const jstDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function officialUrl(value,profile=false){
 let u;try{u=new URL(value)}catch{throw Error('JRAの取得元URLを確認できません。')}
 if(u.protocol!=='https:'||!['www.jra.go.jp','jra.go.jp','www.jra.jp','jra.jp'].includes(u.hostname)||u.username||u.password)throw Error('JRAの取得元URL以外は使用できません。');
 if(profile&&(!/^\/JRADB\/accessU\.html$/i.test(u.pathname)||!/^pw01dud\d{2}/i.test(u.searchParams.get('CNAME')||'')))throw Error('JRA競走馬プロフィールのURLを確認できません。');
 return u.href;
}
export async function ensureCollectionTables(db){
 await ensureHistoryTable(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_history_profile_links(race_key TEXT NOT NULL,horse_name TEXT NOT NULL,age INTEGER NOT NULL,profile_url TEXT NOT NULL,source_url TEXT NOT NULL,checked_at INTEGER NOT NULL,PRIMARY KEY(race_key,horse_name))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_history_collection_receipts(race_key TEXT NOT NULL,horse_name TEXT NOT NULL,policy_version TEXT NOT NULL,requested_limit INTEGER NOT NULL,status TEXT NOT NULL,rows_found INTEGER NOT NULL,checked_at INTEGER NOT NULL,profile_url TEXT,error TEXT,PRIMARY KEY(race_key,horse_name))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_history_collection_budget(name TEXT PRIMARY KEY,locked_until INTEGER NOT NULL,next_batch_at INTEGER NOT NULL,lock_token TEXT)').run();
 await db.prepare("INSERT OR IGNORE INTO lab_history_collection_budget(name,locked_until,next_batch_at) VALUES('jra-history',0,0)").run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_history_collection_targets(race_key TEXT PRIMARY KEY,date TEXT NOT NULL,venue TEXT NOT NULL,race_no INTEGER NOT NULL,history_limit INTEGER NOT NULL,status TEXT NOT NULL,last_run_at INTEGER)').run();
}
async function receipt(db,raceKey,horseName){
 try{return await db.prepare('SELECT * FROM lab_history_collection_receipts WHERE race_key=? AND horse_name=?').bind(raceKey,horseName).first()}catch(e){if(/no such table/.test(String(e)))return null;throw e}
}
export function collectionDue(receiptRow,date,limit,now){
 if(!receiptRow||receiptRow.policy_version!==COLLECTION_POLICY.version||Number(receiptRow.requested_limit)<limit)return true;
 if(receiptRow.status==='failed')return now-Number(receiptRow.checked_at)>=3600000;
 if(receiptRow.status==='checked'&&Number(receiptRow.rows_found)===0)return now-Number(receiptRow.checked_at)>=86400000;
 return date>=jstDay(now)&&now-Number(receiptRow.checked_at)>=COLLECTION_POLICY.futureRefreshMs;
}
async function raceContext(db,input){
 const t=targetInput(input);const race=await db.prepare('SELECT race_key,race_date,venue,race_no,race_name,source_url,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(t.date,t.venue,t.raceNo).first();
 if(!race)throw Error('正式出馬表が未保存です。保存後に収集します。');
 const runners=(await db.prepare('SELECT horse_no,horse_name,age FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all()).results||[];
 if(!runners.length||runners.length!==Number(race.runner_count))throw Error('正式出馬表の保存が不完全です。');
 return{race,runners};
}
export async function collectionStatus(db,input,now=Date.now(),context=null){
 const {race,runners}=context||await raceContext(db,input),limit=integer(input.historyLimit??10,10,1,20),out=[];
 const statistics=(await (context?db.prepare("SELECT p.horse_name,COUNT(*) stored_rows,MIN(p.race_date) oldest_date,MAX(p.race_date) newest_date,SUM(CASE WHEN p.last3f>0 THEN 1 ELSE 0 END) last3f_rows,SUM(CASE WHEN p.corner_positions IS NOT NULL AND p.corner_positions<>'' THEN 1 ELSE 0 END) corner_rows FROM jra_past_performances p JOIN json_each(?) rr ON json_extract(rr.value,'$.horse_name')=p.horse_name WHERE p.race_date>=MAX('2016-01-01',printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-CAST(json_extract(rr.value,'$.age') AS INTEGER)+2)) AND p.race_date<? GROUP BY p.horse_name").bind(JSON.stringify(runners),race.race_date,race.race_date):db.prepare("SELECT p.horse_name,COUNT(*) stored_rows,MIN(p.race_date) oldest_date,MAX(p.race_date) newest_date,SUM(CASE WHEN p.last3f>0 THEN 1 ELSE 0 END) last3f_rows,SUM(CASE WHEN p.corner_positions IS NOT NULL AND p.corner_positions<>'' THEN 1 ELSE 0 END) corner_rows FROM jra_past_performances p JOIN jra_runners rr ON rr.horse_name=p.horse_name WHERE rr.race_key=? AND p.race_date>=MAX('2016-01-01',printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-rr.age+2)) AND p.race_date<? GROUP BY p.horse_name").bind(race.race_key,race.race_date,race.race_date)).all()).results||[];
 const byStats=new Map(statistics.map(x=>[x.horse_name,x]));let receipts=[];
 try{receipts=(await db.prepare('SELECT * FROM lab_history_collection_receipts WHERE race_key=?').bind(race.race_key).all()).results||[]}catch(e){if(!/no such table/.test(String(e)))throw e}
 const byReceipt=new Map(receipts.map(x=>[x.horse_name,x]));
 for(const r of runners){
  const age=Number(r.age);if(!Number.isInteger(age)||age<2||age>20)throw Error('出走馬の年齢を確認できません。');
  const fromDate=[COLLECTION_POLICY.archiveFromDate,String(Number(race.race_date.slice(0,4))-age+2)+'-01-01'].sort().at(-1);
  const stats=byStats.get(r.horse_name),rec=byReceipt.get(r.horse_name);
  out.push({horseNo:r.horse_no==null?null:Number(r.horse_no),horseName:r.horse_name,age,fromDate,storedRows:Number(stats?.stored_rows||0),last3fRows:Number(stats?.last3f_rows||0),cornerRows:Number(stats?.corner_rows||0),oldestDate:stats?.oldest_date||null,newestDate:stats?.newest_date||null,lastCheckedAt:rec?.checked_at?new Date(rec.checked_at).toISOString():null,collectionState:rec?.status||'not-checked',due:collectionDue(rec,race.race_date,limit,now),profileUrl:rec?.profile_url||r.profile_url||null});
 }
 return{ok:true,race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:Number(race.race_no),raceName:race.race_name},historyLimit:limit,runnerCount:out.length,pendingHorses:out.filter(x=>x.due).length,remainingHorses:out.filter(x=>x.due||x.collectionState==='failed').length,totalStoredRows:out.reduce((s,x)=>s+x.storedRows,0),last3fRows:out.reduce((s,x)=>s+x.last3fRows,0),runners:out,policy:COLLECTION_POLICY};
}
async function saveReceipt(db,key,item,limit,status,rows,stamp,profileUrl=null,error=null){
 await db.prepare('INSERT INTO lab_history_collection_receipts(race_key,horse_name,policy_version,requested_limit,status,rows_found,checked_at,profile_url,error) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_name) DO UPDATE SET policy_version=excluded.policy_version,requested_limit=excluded.requested_limit,status=excluded.status,rows_found=excluded.rows_found,checked_at=excluded.checked_at,profile_url=COALESCE(excluded.profile_url,profile_url),error=excluded.error').bind(key,item.horseName,COLLECTION_POLICY.version,limit,status,rows,stamp,profileUrl,error).run();
}
export async function collectHistoryBatch(db,input,deps={}){
 const now=deps.now||Date.now,fetcher=deps.fetcher||fetch,wait=deps.wait||(ms=>new Promise(r=>setTimeout(r,ms)));
 const limit=integer(input.historyLimit??10,10,1,20),batchSize=limit>10?1:integer(input.batchSize??1,1,1,2);
 await ensureCollectionTables(db);const context=deps.context||await raceContext(db,input),before=await collectionStatus(db,{...input,historyLimit:limit},now(),deps.context||null);
 const selected=before.runners.filter(r=>r.due&&(!deps.context||r.profileUrl||r.storedRows>=limit)).sort((a,b)=>Number(a.collectionState==='failed')-Number(b.collectionState==='failed')||a.storedRows-b.storedRows||(a.collectionState==='failed'?String(a.lastCheckedAt).localeCompare(String(b.lastCheckedAt)):0)||a.horseNo-b.horseNo).slice(0,batchSize);
 if(!selected.length)return{ok:true,status:deps.context&&before.remainingHorses?'awaiting-profile-links':'complete',attempted:0,externalRequests:0,before,after:before,policy:COLLECTION_POLICY};
 const stamp=now(),token=crypto.randomUUID();
 const claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes||0)!==1)return{ok:true,status:'cooldown',attempted:0,externalRequests:0,policy:COLLECTION_POLICY};
 let requests=0,cooldown=COLLECTION_POLICY.minBatchGapMs;const results=[];
 async function page(url,profile=false){
  officialUrl(url,profile);if(requests)await wait(COLLECTION_POLICY.minRequestGapMs);requests++;
  if(requests>COLLECTION_POLICY.maxExternalRequestsPerBatch)throw Error('取得上限を超えました。');
  const response=await fetcher(url,{headers:{'user-agent':'KEIBA-LABO/3.32 (bounded official history collector)',accept:'text/html'},signal:AbortSignal.timeout(10000),redirect:'follow'});
  if(response.url)officialUrl(response.url,profile);
  if(!response.ok){if(response.status===429||response.status===503)cooldown=3600000;throw Error('JRA取得 HTTP '+response.status)}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('取得ページが上限サイズを超えました。');
  return new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
 }
 try{
  let links=null,resultSourceChecked=false;
  for(const item of selected){
   let profileUrl=item.profileUrl;
   try{
    if(item.storedRows>=limit){await saveReceipt(db,context.race.race_key,item,limit,'stored-enough',item.storedRows,now());results.push({horseName:item.horseName,status:'stored-enough',savedRows:0});continue}
    if(!profileUrl){const known=await db.prepare('SELECT source_url FROM jra_past_performances WHERE horse_name=? AND race_date>=? AND race_date<? AND source_url IS NOT NULL ORDER BY fetched_at DESC LIMIT 1').bind(item.horseName,item.fromDate,context.race.race_date).first();try{profileUrl=officialUrl(known?.source_url,true)}catch{}}
    if(!profileUrl){const cached=await db.prepare('SELECT profile_url FROM lab_history_profile_links WHERE race_key=? AND horse_name=? AND age=? AND source_url=? AND (?<? OR checked_at>?)').bind(context.race.race_key,item.horseName,item.age,context.race.source_url,context.race.race_date,jstDay(now()),now()-86400000).first();if(cached)profileUrl=officialUrl(cached.profile_url,true)}
    if(!profileUrl&&!links&&!resultSourceChecked){
     resultSourceChecked=true;const resultUrl=await storedHistoryResultSource(db,context.race,jstDay(now()));
     if(resultUrl)links=resultProfileLinks(await page(resultUrl),context.runners,resultUrl);
    }
    if(!profileUrl){if(!links){const html=await page(officialUrl(context.race.source_url));links=extractProfileLinks(html,context.runners.map(r=>r.horse_name),context.race.source_url);const pairs=context.runners.filter(r=>links.has(r.horse_name)).map(r=>[r.horse_name,Number(r.age),officialUrl(links.get(r.horse_name),true)]);if(pairs.length)await db.prepare("INSERT INTO lab_history_profile_links SELECT ?,json_extract(value,'$[0]'),CAST(json_extract(value,'$[1]') AS INTEGER),json_extract(value,'$[2]'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(race_key,horse_name) DO UPDATE SET age=excluded.age,profile_url=excluded.profile_url,source_url=excluded.source_url,checked_at=excluded.checked_at").bind(context.race.race_key,context.race.source_url,now(),JSON.stringify(pairs)).run()}profileUrl=links.get(item.horseName)}
    if(!profileUrl){
     const prior=(await db.prepare("SELECT DISTINCT l.profile_url,l.source_url FROM lab_history_profile_links l JOIN jra_races r ON r.race_key=l.race_key JOIN jra_runners x ON x.race_key=r.race_key AND x.horse_name=l.horse_name AND x.age=l.age WHERE l.source_url=r.source_url AND l.horse_name=? AND r.race_date>=? AND r.race_date<? AND x.age=(?-(CAST(substr(?,1,4) AS INTEGER)-CAST(substr(r.race_date,1,4) AS INTEGER)))").bind(item.horseName,item.fromDate,context.race.race_date,item.age,context.race.race_date).all()).results||[];
     const verified=new Set();for(const link of prior){try{officialUrl(link.source_url);verified.add(officialUrl(link.profile_url,true));}catch{}}
     if(verified.size===1)profileUrl=[...verified][0];
    }
    if(!profileUrl)throw Error('JRA競走馬リンクが未取得です。');
    const html=await page(profileUrl,true);
    if(!html.includes(item.horseName))throw Error('プロフィールの馬名を確認できません。');
    const performances=parsePastPerformances(html,item.horseName,profileUrl,context.race.race_date,200).filter(p=>p.raceDate>=item.fromDate).slice(0,limit);
    if(!performances.length&&!/0戦|未出走|出走歴はありません/.test(html)&&!parsePastPerformances(html,item.horseName,profileUrl,'9999-12-31',200).length)throw Error('過去走テーブルを確認できません。履歴ゼロとは判定していません。');
    const at=new Date(now()).toISOString();
    if(performances.length)await db.batch(performances.map(p=>db.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,popularity,odds,jockey,assigned_weight,body_weight,body_weight_change,time_text,last3f,corner_positions,track_condition,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(horse_name,race_date,venue,race_name) DO UPDATE SET surface=COALESCE(excluded.surface,surface),distance=COALESCE(excluded.distance,distance),finish_position=COALESCE(excluded.finish_position,finish_position),field_size=COALESCE(excluded.field_size,field_size),jockey=COALESCE(excluded.jockey,jockey),assigned_weight=COALESCE(excluded.assigned_weight,assigned_weight),body_weight=COALESCE(excluded.body_weight,body_weight),body_weight_change=COALESCE(excluded.body_weight_change,body_weight_change),time_text=COALESCE(excluded.time_text,time_text),last3f=COALESCE(excluded.last3f,last3f),corner_positions=COALESCE(excluded.corner_positions,corner_positions),track_condition=COALESCE(excluded.track_condition,track_condition),source_url=excluded.source_url,fetched_at=excluded.fetched_at').bind(p.horseName,p.raceDate,p.venue,p.raceName,p.surface,p.distance,p.finishPosition,p.fieldSize,null,null,p.jockey,p.assignedWeight,p.bodyWeight,p.bodyWeightChange,p.timeText,p.last3f,p.cornerPositions,p.trackCondition,p.sourceUrl,at)));
    await saveReceipt(db,context.race.race_key,item,limit,'checked',performances.length,now(),profileUrl);
    results.push({horseName:item.horseName,status:'checked',savedRows:performances.length,profileUrl,oldestDate:performances.at(-1)?.raceDate||null});
   }catch(error){await saveReceipt(db,context.race.race_key,item,limit,'failed',0,now(),profileUrl,String(error.message||error));results.push({horseName:item.horseName,status:'failed',savedRows:0,error:String(error.message||error)});if(cooldown>COLLECTION_POLICY.minBatchGapMs)break}
  }
 }finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+cooldown,token).run()}
 const after=await collectionStatus(db,{...input,historyLimit:limit},now(),deps.context||null);
 return{ok:results.every(r=>r.status!=='failed'),status:results.some(r=>r.status==='failed')?'partial':'collected',attempted:results.length,externalRequests:requests,results,before,after,addedRows:after.totalStoredRows-before.totalStoredRows,nextBatchAt:new Date(now()+cooldown).toISOString(),policy:COLLECTION_POLICY,guardrails:{targetDateExcluded:true,officialSourceOnly:true,lockedPredictionWrites:false,noOddsIngested:true,last3fMayRemainMissing:true}};
}
export async function scheduledCollection(db,deps={}){
 const now=deps.now||Date.now;await ensureCollectionTables(db);const today=jstDay(now());
 await db.prepare("INSERT OR IGNORE INTO lab_history_collection_targets(race_key,date,venue,race_no,history_limit,status) SELECT race_key,race_date,venue,race_no,10,'pending' FROM jra_races WHERE race_date>=? AND race_date<=? AND runner_count>0").bind(dayOffset(today,-7),dayOffset(today,7)).run();
 let targetRows;try{targetRows=await db.prepare("SELECT t.* FROM lab_history_collection_targets t LEFT JOIN lab_learning_collection_receipts l ON l.race_key=t.race_key AND l.experiment_id='safe-core-shadow-20261010-v1' WHERE "+(deps.trainingOnly?"t.date<'"+today+"' AND ":"")+"(t.status='pending' OR (t.date>=? AND COALESCE(t.last_run_at,0)<?) OR EXISTS(SELECT 1 FROM lab_history_collection_receipts empty WHERE empty.race_key=t.race_key AND empty.status='checked' AND empty.rows_found=0 AND empty.checked_at<="+(now()-86400000)+")) AND EXISTS(SELECT 1 FROM jra_runners rr LEFT JOIN lab_history_collection_receipts cr ON cr.race_key=rr.race_key AND cr.horse_name=rr.horse_name WHERE rr.race_key=t.race_key AND (cr.horse_name IS NULL OR cr.policy_version<>? OR cr.requested_limit<t.history_limit OR (cr.status='failed' AND cr.checked_at<=?) OR (cr.status='checked' AND cr.rows_found=0 AND cr.checked_at<="+(now()-86400000)+") OR (t.date>=? AND cr.status<>'failed' AND cr.checked_at<=?))) ORDER BY CASE WHEN t.date>=? THEN 0 WHEN EXISTS(SELECT 1 FROM jra_races p WHERE p.race_key=t.race_key AND (p.race_name LIKE '%新馬%' OR p.race_name LIKE 'メイクデビュー%')) THEN 3 WHEN l.status='awaiting-prior-history' THEN 1 ELSE 2 END,"+missingPriorHistorySql('t.race_key','t.date')+",COALESCE(t.last_run_at,0),t.date,t.race_no DESC LIMIT 1").bind(today,now()-86400000,COLLECTION_POLICY.version,now()-3600000,today,now()-86400000,today).all()}catch(error){if(!/no such table: lab_learning_collection_receipts/.test(String(error)))throw error;targetRows=await db.prepare("SELECT t.* FROM lab_history_collection_targets t WHERE "+(deps.trainingOnly?"t.date<'"+today+"' AND ":"")+"(t.status='pending' OR (t.date>=? AND COALESCE(t.last_run_at,0)<?) OR EXISTS(SELECT 1 FROM lab_history_collection_receipts empty WHERE empty.race_key=t.race_key AND empty.status='checked' AND empty.rows_found=0 AND empty.checked_at<="+(now()-86400000)+")) AND EXISTS(SELECT 1 FROM jra_runners rr LEFT JOIN lab_history_collection_receipts cr ON cr.race_key=rr.race_key AND cr.horse_name=rr.horse_name WHERE rr.race_key=t.race_key AND (cr.horse_name IS NULL OR cr.policy_version<>? OR cr.requested_limit<t.history_limit OR (cr.status='failed' AND cr.checked_at<=?) OR (cr.status='checked' AND cr.rows_found=0 AND cr.checked_at<="+(now()-86400000)+") OR (t.date>=? AND cr.status<>'failed' AND cr.checked_at<=?))) ORDER BY CASE WHEN t.date>=? THEN 0 ELSE 1 END,COALESCE(t.last_run_at,0),t.date,t.race_no DESC LIMIT 1").bind(today,now()-86400000,COLLECTION_POLICY.version,now()-3600000,today,now()-86400000,today).all()}
 const targets=targetRows.results||[];
 for(const t of targets){const input={date:t.date,venue:t.venue,raceNo:t.race_no,historyLimit:t.history_limit,batchSize:COLLECTION_POLICY.scheduledHorsesPerRun};const result=await collectHistoryBatch(db,input,deps);await db.prepare('UPDATE lab_history_collection_targets SET status=?,last_run_at=? WHERE race_key=?').bind(result.after?.remainingHorses===0?'complete':'pending',now(),t.race_key).run();if(result.externalRequests||result.status==='cooldown')return result}
 return{ok:true,status:'idle',externalRequests:0,policy:COLLECTION_POLICY};
}
