import {assessPositionHistory} from './running-style-evidence.js';
import {assessmentContext} from './race-history-assessment-v3.31.0.js';
import {ensureCollectionTables,officialUrl} from './history-collection-v3.37.0.js';
import {parsePastPerformances} from './collection-profile-parser-v3.32.0.js';
import {parseOfficialResultDetails} from './result-detail-v3.39.0.js';
import {jraPageRequest,isJraSourceBlocked} from './jra-page-request.js';
const venues=['','札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
export const PRIOR_DETAIL_POLICY={version:'verified-prior-result-v1',maxHorsesPerBatch:1,maxExternalRequestsPerBatch:2,minRequestGapMs:5000,minBatchGapMs:60000,targetDateExcluded:true,scoreWeightsChanged:false,userMarksChanged:false};
export function priorResultLinks(html,horseName,profileUrl,targetDate){
 const links=[];
 for(const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const p=parsePastPerformances('<table><tr>'+row+'</tr></table>',horseName,profileUrl,targetDate,1)[0];if(!p)continue;
  for(const [,href] of row.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
   const u=new URL(href.replace(/&amp;/g,'&'),profileUrl);try{officialUrl(u.href)}catch{continue}
   if(u.pathname!=='/JRADB/accessS.html')continue;
   const m=(u.searchParams.get('CNAME')||'').match(/^pw01sde\d{2}(\d{2})(\d{4})\d{4}(\d{2})(\d{8})\/[A-Za-z0-9]+$/);
   if(!m||venues[Number(m[1])]!==p.venue||m[2]!==p.raceDate.slice(0,4)||m[4]!==p.raceDate.replaceAll('-','')||Number(m[3])<1||Number(m[3])>12)continue;
   links.push({...p,resultUrl:u.href});
  }
 }
 return links;
}
export function verifiedPriorDetail(html,p,profileUrl,targetDate){
 if(!p||p.raceDate>=targetDate)throw Error('開催日以降の履歴は使用できません。');
 const bound=priorResultLinks(p.profileHtml||'',p.horseName,profileUrl,targetDate).filter(x=>x.resultUrl===p.resultUrl&&x.raceDate===p.raceDate&&x.venue===p.venue&&x.raceName===p.raceName);
 if(bound.length!==1)throw Error('プロフィールと結果の出典を照合できません。');
 const compact=html.replace(/<[^>]+>/g,'').replace(/\s/g,'');const [y,m,d]=p.raceDate.split('-').map(Number);
 if(!compact.includes(`${y}年${m}月${d}日`)||!compact.includes(p.venue))throw Error('結果ページの開催日・競馬場を照合できません。');
 const parsed=parseOfficialResultDetails(html),rows=parsed.rows;
 if(!parsed.ok||rows.length!==Number(p.fieldSize)||new Set(rows.map(x=>x.horseName)).size!==rows.length||new Set(rows.map(x=>x.horseNo)).size!==rows.length||rows.some(x=>!Number.isInteger(x.horseNo)||x.horseNo<1||x.horseNo>40))throw Error('結果の頭数・馬番を照合できません。');
 const x=rows.find(x=>x.horseName===p.horseName);
 if(!x||x.finishStatus!=='finished'||x.finishPosition!==Number(p.finishPosition)||!Number.isInteger(x.finishPosition)||x.finishPosition<1||x.finishPosition>rows.length)throw Error('馬名・着順を照合できません。');
 const parts=String(x.cornerPositions||'').replace(/[０-９]/g,c=>String(c.charCodeAt(0)-65296)).split(/(?:\s*[-－–→/]\s*|\s+)/);
 const corners=parts.length>=2&&parts.length<=4&&parts.every(n=>/^\d+$/.test(n)&&Number(n)>=1&&Number(n)<=rows.length)?parts.join('-'):null;
 const last3f=p.surface!=='障害'&&Number.isFinite(x.last3f)&&x.last3f>=20&&x.last3f<=80?x.last3f:null;
 return{last3f,cornerPositions:corners,horseNo:x.horseNo};
}
async function ensure(db){
 await ensureCollectionTables(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_prior_detail_targets(race_key TEXT PRIMARY KEY,date TEXT NOT NULL,venue TEXT NOT NULL,race_no INTEGER NOT NULL,last_run_at INTEGER NOT NULL DEFAULT 0)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_prior_detail_attempts(past_id INTEGER PRIMARY KEY,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL,status TEXT NOT NULL,error TEXT)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_prior_detail_evidence(past_id INTEGER NOT NULL,source_sha256 TEXT NOT NULL,result_url TEXT NOT NULL,profile_url TEXT NOT NULL,detail_json TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(past_id,source_sha256))').run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_prior_detail_no_${action.toLowerCase()} BEFORE ${action} ON lab_prior_detail_evidence BEGIN SELECT RAISE(ABORT,'prior detail evidence is immutable'); END`).run();
}
async function candidates(db,c){
 return(await db.prepare("SELECT p.* FROM jra_past_performances p JOIN jra_runners r ON r.horse_name=p.horse_name AND r.race_key=? WHERE p.race_date<? AND r.age BETWEEN 2 AND 20 AND p.race_date>=MAX('2016-01-01',printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-r.age+2)) AND p.finish_position BETWEEN 1 AND p.field_size AND p.surface=? AND ABS(p.distance-?)<=400 AND (p.last3f IS NULL OR p.corner_positions IS NULL OR p.corner_positions='') ORDER BY p.race_date DESC,p.id").bind(c.raceKey,c.date,c.date,c.surface,c.distance).all()).results||[];
}
export function profilePositionCoverage(rows,c){
 return c.runners.map(r=>{const recent=rows.filter(p=>p.horse_name===r.horse_name).sort((a,b)=>String(b.race_date).localeCompare(a.race_date)||b.id-a.id).slice(0,8).map(p=>({date:p.race_date,venue:p.venue,surface:p.surface,distance:Number(p.distance),fieldSize:Number(p.field_size),finish:Number(p.finish_position),cornerPositions:p.corner_positions}));
  const a=assessPositionHistory({available:true,recent},c);return{horseName:r.horse_name,horseNo:Number(r.horse_no),validPositionRows:a.validPositionRows,neededRows:Math.max(0,3-a.validPositionRows),basis:'stored-profile-latest-eight',predictionStatusNotInferred:true};});
}
async function coverage(db,c){
 const rows=(await db.prepare("SELECT p.* FROM jra_past_performances p JOIN jra_runners r ON r.horse_name=p.horse_name AND r.race_key=? WHERE p.race_date<? AND r.age BETWEEN 2 AND 20 AND p.race_date>=MAX('2016-01-01',printf('%d-01-01',CAST(substr(?,1,4) AS INTEGER)-r.age+2)) ORDER BY p.race_date DESC,p.id DESC").bind(c.raceKey,c.date,c.date).all()).results||[];
 return profilePositionCoverage(rows,c);
}
export function selectPriorCandidate(rows,attempts,positionCoverage,stamp){
 const by=new Map(attempts.map(a=>[Number(a.past_id),a])),counts=new Map(positionCoverage.map(r=>[r.horseName,r.validPositionRows]));
 return rows.filter(p=>Number(by.get(p.id)?.retry_at||0)<=stamp).sort((a,b)=>{
  const ca=counts.get(a.horse_name)||0,cb=counts.get(b.horse_name)||0;
  return Number(ca>=3)-Number(cb>=3)||Math.min(ca,3)-Math.min(cb,3)||Number(by.get(a.id)?.checked_at||0)-Number(by.get(b.id)?.checked_at||0)||String(b.race_date).localeCompare(a.race_date)||a.id-b.id;
 })[0]||null;
}
async function schedulerStatus(db,c){
 let target=null,run=null;
 try{target=await db.prepare('SELECT last_run_at FROM lab_prior_detail_targets WHERE race_key=?').bind(c.raceKey).first()}catch(e){if(!/no such table/.test(String(e)))throw e}
 try{run=await db.prepare("SELECT started_at,finished_at,status,result_json,error FROM lab_bounded_pipeline_runs WHERE job='prior-details' AND trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 1").first()}catch(e){if(!/no such table/.test(String(e)))throw e}
 const result=run?.result_json?JSON.parse(run.result_json):null;
 return{targetLastCheckedAt:target?.last_run_at?new Date(target.last_run_at).toISOString():null,lastRun:run?{startedAt:new Date(run.started_at).toISOString(),finishedAt:run.finished_at?new Date(run.finished_at).toISOString():null,status:run.status,error:run.error||null,result,raceMatches:result?.raceKey===c.raceKey}:null,manualRunsProveCron:false};
}
export async function priorDetailStatus(db,input,stamp=Date.now()){
 const c=await assessmentContext(db,input),pending=await candidates(db,c);let attempts=[],budget=null;
 try{attempts=(await db.prepare('SELECT * FROM lab_prior_detail_attempts').all()).results||[];budget=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first()}catch(e){if(!/no such table/.test(String(e)))throw e}
 const by=new Map(attempts.map(a=>[Number(a.past_id),a]));
 return{ok:true,race:{date:c.date,venue:c.venue,raceNo:c.raceNo,runnerCount:c.runners.length},positionCoverage:await coverage(db,c),scheduler:await schedulerStatus(db,c),remainingRows:pending.length,readyRows:pending.filter(p=>Number(by.get(p.id)?.retry_at||0)<=stamp).length,nextBatchAt:budget?new Date(Math.max(budget.next_batch_at,budget.locked_until)).toISOString():null,rows:pending.map(p=>({pastId:p.id,horseName:p.horse_name,date:p.race_date,venue:p.venue,raceName:p.race_name,missingLast3f:p.last3f==null,missingCorners:!p.corner_positions,status:by.get(p.id)?.status||'pending',error:by.get(p.id)?.error||null,retryAt:by.has(p.id)?new Date(by.get(p.id).retry_at).toISOString():null})),policy:PRIOR_DETAIL_POLICY};
}
export async function collectPriorDetails(db,input,deps={}){
 const now=deps.now||Date.now,fetcher=deps.fetcher||fetch,wait=deps.wait||(ms=>new Promise(r=>setTimeout(r,ms)));
 await ensure(db);const c=await assessmentContext(db,input),rows=await candidates(db,c),attempts=(await db.prepare('SELECT * FROM lab_prior_detail_attempts').all()).results||[];
 await db.prepare('INSERT OR IGNORE INTO lab_prior_detail_targets(race_key,date,venue,race_no) VALUES(?,?,?,?)').bind(c.raceKey,c.date,c.venue,c.raceNo).run();
 const p=selectPriorCandidate(rows,attempts,await coverage(db,c),now());
 if(!p)return{ok:true,status:rows.length?'waiting':'complete',externalRequests:0,savedRows:0};
 const stamp=now(),token=crypto.randomUUID(),lease=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(lease.meta?.changes||0)!==1)return{ok:true,status:'cooldown',externalRequests:0,savedRows:0};
 let calls=0,cooldown=60000,result;
 async function page(url){
  officialUrl(url);if(calls>=2)throw Error('取得上限です。');if(calls)await wait(5000);calls++;
  const request=jraPageRequest(url),response=await fetcher(request.url,request.options);
  if(!response.ok){if(isJraSourceBlocked(response.status))cooldown=3600000;throw Error('JRA取得 HTTP '+response.status)}
  if(response.url){const a=new URL(url),b=new URL(officialUrl(response.url));if(a.origin!==b.origin||a.pathname!==b.pathname||(b.searchParams.has('CNAME')&&a.searchParams.get('CNAME')!==b.searchParams.get('CNAME')))throw Error('転送先が対象と一致しません。')}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('ページサイズ上限です。');return new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
 }
 try{
  const profileUrl=officialUrl(p.source_url,true),profileHtml=await page(profileUrl);
  if(!profileHtml.includes(p.horse_name))throw Error('プロフィールの馬名を確認できません。');
  const links=priorResultLinks(profileHtml,p.horse_name,profileUrl,c.date).filter(x=>x.raceDate===p.race_date&&x.venue===p.venue&&x.raceName===p.race_name&&x.finishPosition===p.finish_position&&x.fieldSize===p.field_size&&x.surface===p.surface&&x.distance===p.distance);
  if(links.length!==1)throw Error('保存済み過去走と公式プロフィールを照合できません。');
  const linked=links[0],html=await page(linked.resultUrl),detail=verifiedPriorDetail(html,{...linked,profileHtml},profileUrl,c.date),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!detail.last3f&&!detail.cornerPositions)throw Error('結果ページに検証可能な通過順・上がりがありません。');
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO lab_prior_detail_evidence VALUES(?,?,?,?,?,?)').bind(p.id,hash,linked.resultUrl,profileUrl,JSON.stringify({horseName:p.horse_name,date:p.race_date,venue:p.venue,raceName:p.race_name,finishPosition:p.finish_position,fieldSize:p.field_size,...detail}),new Date(now()).toISOString()),
   db.prepare("UPDATE jra_past_performances SET last3f=COALESCE(last3f,?),corner_positions=CASE WHEN corner_positions IS NULL OR corner_positions='' THEN ? ELSE corner_positions END WHERE id=? AND horse_name=? AND race_date=? AND venue=? AND race_name=? AND finish_position=? AND field_size=?").bind(detail.last3f,detail.cornerPositions,p.id,p.horse_name,p.race_date,p.venue,p.race_name,p.finish_position,p.field_size)
  ]);
  result={ok:true,status:'collected',savedRows:1,horseName:p.horse_name,date:p.race_date,detail,resultUrl:linked.resultUrl};
 }catch(error){result={ok:false,status:'failed',savedRows:0,horseName:p.horse_name,date:p.race_date,error:String(error.message||error)}}
 finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+cooldown,token).run()}
 await db.prepare('INSERT INTO lab_prior_detail_attempts VALUES(?,?,?,?,?) ON CONFLICT(past_id) DO UPDATE SET checked_at=excluded.checked_at,retry_at=excluded.retry_at,status=excluded.status,error=excluded.error').bind(p.id,now(),now()+(result.ok?86400000:3600000),result.status,result.error||null).run();
 return{...result,raceKey:c.raceKey,externalRequests:calls,nextBatchAt:new Date(now()+cooldown).toISOString(),policy:PRIOR_DETAIL_POLICY};
}

export async function scheduledPriorDetails(db,deps={}){
 let targets;try{targets=(await db.prepare('SELECT * FROM lab_prior_detail_targets ORDER BY last_run_at LIMIT 8').all()).results||[]}catch(e){if(/no such table/.test(String(e)))return{ok:true,status:'idle',externalRequests:0};throw e}
 for(const t of targets){
  const input={date:t.date,venue:t.venue,raceNo:t.race_no},status=await priorDetailStatus(db,input,(deps.now||Date.now)());
  await db.prepare('UPDATE lab_prior_detail_targets SET last_run_at=? WHERE race_key=?').bind((deps.now||Date.now)(),t.race_key).run();
  if(!status.readyRows)continue;
  return collectPriorDetails(db,input,deps);
 }
 return{ok:true,status:'idle',externalRequests:0};
}
