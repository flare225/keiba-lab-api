import {ensureResultSources,resultSourceMeta,discoverResultSource,resultDiscoveryTarget} from './official-result-sources-v3.39.0.js';
import {parseOfficialResultDetails,persistVerifiedResultDetails,ensureResultDetailTables} from './result-detail-v3.39.0.js';
import {ensureCollectionTables,officialUrl,jstDay} from './history-collection-v3.32.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
export const RICH_POLICY={version:'bounded-jra-result-v1',maxRacesPerBatch:1,maxExternalRequestsPerBatch:1,concurrency:1,minBatchGapMs:60000,throttlePauseMs:3600000,scheduledCron:'8,18,28,38,48,58 * * * *',archivedDatesSupported:true,sourcePriority:'JRA',targetDayExcludedFromAssessment:true};
const requiresCorners=r=>r.surface!=='障害'&&!(r.venue==='新潟'&&r.surface==='芝'&&Number(r.distance)===1000);
const missingLast="SUM(CASE WHEN d.finish_position IS NOT NULL AND (d.last3f IS NULL OR d.last3f<=0) THEN 1 ELSE 0 END)";
const missingCorner="SUM(CASE WHEN d.finish_position IS NOT NULL AND (d.corner_positions IS NULL OR d.corner_positions='') THEN 1 ELSE 0 END)";
export async function richResultStatus(db,date){
 targetInput({date,venue:'東京',raceNo:1});
 const rows=(await db.prepare(`SELECT r.race_key,r.race_date,r.venue,r.race_no,r.race_name,r.runner_count,r.surface,r.distance,COUNT(d.id) detail_rows,COUNT(DISTINCT d.horse_no) detail_distinct,${missingLast} last3f_missing,${missingCorner} corners_missing,MAX(d.source_url) source_url FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key WHERE r.race_date=? GROUP BY r.race_key ORDER BY r.venue,r.race_no`).bind(date).all()).results||[];
 const details=rows.map(r=>{const complete=Number(r.runner_count)>0&&Number(r.detail_rows)===Number(r.runner_count)&&Number(r.detail_distinct)===Number(r.runner_count);return{...r,complete,last3fComplete:complete&&Number(r.last3f_missing)===0,richComplete:complete&&Number(r.last3f_missing)===0&&(!requiresCorners(r)||Number(r.corners_missing)===0)}});
 const expected=details.reduce((s,x)=>s+Number(x.runner_count),0),stored=details.reduce((s,x)=>s+Number(x.detail_rows),0);
 return{ok:true,date,runnerRows:{expected,stored,coveragePct:expected?Math.round(stored/expected*1000)/10:0},incompleteRaces:details.filter(x=>!x.complete).length,races:details.length,completeRaces:details.filter(x=>x.complete).length,richCompleteRaces:details.filter(x=>x.richComplete).length,incompleteRichRaces:details.filter(x=>!x.richComplete).length,last3fMissing:details.reduce((s,x)=>s+Number(x.last3f_missing),0),cornersMissing:details.reduce((s,x)=>s+Number(x.corners_missing),0),learningReady:details.length>0&&details.every(x=>x.richComplete),details,policy:RICH_POLICY};
}
async function ensure(db){await ensureCollectionTables(db);await ensureResultDetailTables(db);await ensureResultSources(db);await db.prepare('CREATE TABLE IF NOT EXISTS lab_rich_collection_receipts(race_key TEXT PRIMARY KEY,policy_version TEXT NOT NULL,status TEXT NOT NULL,checked_at INTEGER NOT NULL,next_check_at INTEGER NOT NULL,last3f_rows INTEGER NOT NULL,corners_rows INTEGER NOT NULL,error TEXT)').run()}
export async function collectRichResult(db,input,deps={}){
 const now=deps.now||Date.now,fetcher=deps.fetcher||fetch,t=targetInput(input);
 if(t.date>=jstDay(now()))throw Error('詳細結果の補完は前日以前のレースを対象にします。');
 if(!deps.tablesEnsured)await ensure(db);
 const race=await db.prepare('SELECT race_key,race_date,venue,race_no,race_name,runner_count,surface,distance FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(t.date,t.venue,t.raceNo).first();if(!race)throw Error('正式出馬表が未保存です。');
 const runners=(await db.prepare('SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all()).results||[];
 if(!runners.length||runners.length!==Number(race.runner_count)||runners.length>18)throw Error('正式出馬表の全馬を確認できません。');
 const status=await richResultStatus(db,t.date),existing=status.details.find(x=>x.race_key===race.race_key);
 const rec=await db.prepare('SELECT * FROM lab_rich_collection_receipts WHERE race_key=?').bind(race.race_key).first();
 if(existing?.richComplete)return{ok:true,status:'complete',externalRequests:0,raceKey:race.race_key,storedRows:runners.length,complete:true,last3fMissing:0,policy:RICH_POLICY};
 if(rec?.policy_version===RICH_POLICY.version&&Number(rec.next_check_at)>now())return{ok:true,status:'receipt-cooldown',externalRequests:0,nextCheckAt:new Date(rec.next_check_at).toISOString(),raceKey:race.race_key,policy:RICH_POLICY};
 const published=await db.prepare('SELECT source_url FROM lab_official_result_sources WHERE race_key=?').bind(race.race_key).first();
 const legacy=await db.prepare('SELECT source_url,COUNT(*) n FROM lab_race_outcomes WHERE race_key=? AND source_url IS NOT NULL GROUP BY source_url ORDER BY n DESC LIMIT 1').bind(race.race_key).first();
 const source=published||legacy;
 if(!source?.source_url)return{ok:false,status:'source-unresolved',externalRequests:0,raceKey:race.race_key,error:'JRA結果ページの取得元が未保存です。',policy:RICH_POLICY};
 const sourceMeta=resultSourceMeta(source.source_url);if(!sourceMeta||sourceMeta.date!==t.date||sourceMeta.venue!==t.venue||sourceMeta.raceNo!==t.raceNo)throw Error('結果取得元のレース日付・競馬場・番号が一致しません。');
 const url=officialUrl(source.source_url),stamp=now(),token=crypto.randomUUID();
 const claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return{ok:true,status:'cooldown',externalRequests:0,policy:RICH_POLICY};
 let cooldown=60000,rows3f=0,rowsCorner=0,result;
 try{
  const response=await fetcher(url,{headers:{'user-agent':'KEIBA-LABO/3.33 (bounded official result collector)',accept:'text/html'},signal:AbortSignal.timeout(10000),redirect:'follow'});
  const finalUrl=officialUrl(response.url||url);const redirected=resultSourceMeta(finalUrl);if(!redirected||redirected.raceKey!==sourceMeta.raceKey)throw Error('結果ページの転送先が対象レースと一致しません。');
  if(!response.ok){if([429,503].includes(response.status))cooldown=3600000;throw Error('JRA取得 HTTP '+response.status)}
  const buffer=await response.arrayBuffer();if(buffer.byteLength>1500000)throw Error('取得ページが上限サイズを超えました。');
  const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(buffer);
  const parsed=parseOfficialResultDetails(html,runners);
  if(!parsed.ok||parsed.identity?.verified!==true)throw Error('全馬の馬名・馬番が一致しません。保存していません。');
  for(const r of parsed.rows)if(r.finishPosition==null&&!['scratched','excluded','did-not-finish','disqualified'].includes(r.finishStatus))throw Error('着順・競走状態を確認できません。保存していません。');
  for(const r of parsed.rows)if(r.last3f!=null&&(!Number.isFinite(r.last3f)||r.last3f<20||r.last3f>90))throw Error('上がりの値を確認できません。保存していません。');
  // Result updates must not erase richer values obtained earlier.
  const old=(await db.prepare('SELECT horse_no,last3f,corner_positions,source_url,source_sha256 FROM lab_race_result_details WHERE race_key=?').bind(race.race_key).all()).results||[];
  for(const r of parsed.rows){const prior=old.find(x=>Number(x.horse_no)===r.horseNo);const fields=[];if(r.last3f==null&&prior?.last3f!=null){r.last3f=prior.last3f;fields.push('last3f')}if(!r.cornerPositions&&prior?.corner_positions){r.cornerPositions=prior.corner_positions;fields.push('cornerPositions')}if(fields.length)r.retainedEvidence={fields,sourceUrl:prior.source_url,sourceSha256:prior.source_sha256};}
  rows3f=parsed.rows.filter(x=>x.last3f!=null).length;rowsCorner=parsed.rows.filter(x=>x.cornerPositions).length;
  const missing=parsed.rows.filter(x=>x.finishPosition!=null&&(x.last3f==null||(requiresCorners(race)&&!x.cornerPositions))).length;
  const saved=await persistVerifiedResultDetails(db,{raceKey:race.race_key,runners,sourceUrl:finalUrl,sourceHtml:html,parsed,fetchedAt:new Date(now()).toISOString(),tablesEnsured:true,preserveOutcomes:!published});
  result={ok:true,status:missing?'partial':'collected',externalRequests:1,raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,storedRows:saved.storedRows,complete:true,last3fRows:rows3f,cornerRows:rowsCorner,richMissing:missing,revisionId:saved.revisionId,sourceSha256:saved.sourceSha256,identity:parsed.identity,fields:['finish','time','margin','cornerPositions','last3f','popularity','odds','bodyWeight','jockey','assignedWeight'],guardrails:{officialJraSource:true,runnerIdentityVerified:true,modelLockMutation:false,weightMutation:false}};
 }catch(error){result={ok:false,status:'failed',externalRequests:1,raceKey:race.race_key,error:String(error.message||error)}}
 finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,next_batch_at=?,lock_token=NULL WHERE name='jra-history' AND lock_token=?").bind(now()+cooldown,token).run()}
 const next=result.status==='failed'?now()+3600000:now()+86400000;
 await db.prepare('INSERT INTO lab_rich_collection_receipts(race_key,policy_version,status,checked_at,next_check_at,last3f_rows,corners_rows,error) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET policy_version=excluded.policy_version,status=excluded.status,checked_at=excluded.checked_at,next_check_at=excluded.next_check_at,last3f_rows=excluded.last3f_rows,corners_rows=excluded.corners_rows,error=excluded.error').bind(race.race_key,RICH_POLICY.version,result.status,now(),next,rows3f,rowsCorner,result.error||null).run();
 return{...result,nextCheckAt:new Date(next).toISOString(),nextBatchAt:new Date(now()+cooldown).toISOString(),policy:RICH_POLICY};
}
export async function scheduledRichResult(db,deps={}){
 const now=deps.now||Date.now;await ensure(db);const today=jstDay(now()),fromDate=new Date(Date.parse(today+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
 const race=await db.prepare(`SELECT r.race_date,r.venue,r.race_no FROM jra_races r LEFT JOIN lab_race_result_details d ON d.race_key=r.race_key LEFT JOIN lab_rich_collection_receipts c ON c.race_key=r.race_key WHERE (r.race_date>=? OR EXISTS(SELECT 1 FROM lab_official_result_sources s WHERE s.race_key=r.race_key)) AND r.race_date<? AND (c.race_key IS NULL OR c.policy_version<>? OR c.next_check_at<=?) AND (EXISTS(SELECT 1 FROM lab_race_outcomes o WHERE o.race_key=r.race_key AND o.source_url IS NOT NULL) OR EXISTS(SELECT 1 FROM lab_official_result_sources s WHERE s.race_key=r.race_key)) GROUP BY r.race_key HAVING COUNT(d.id)<r.runner_count OR ${missingLast}>0 OR (r.surface<>'障害' AND NOT(r.venue='新潟' AND r.surface='芝' AND COALESCE(r.distance,0)=1000) AND ${missingCorner}>0) ORDER BY COALESCE(c.checked_at,0),r.race_date,r.venue,r.race_no LIMIT 1`).bind(fromDate,today,RICH_POLICY.version,now()).first();
 const sourceTarget=await resultDiscoveryTarget(db,now());if(sourceTarget&&(!race||sourceTarget.race_date<race.race_date))return{...await discoverResultSource(db,{...deps,sourceTarget}),policy:RICH_POLICY};
 return race?collectRichResult(db,{date:race.race_date,venue:race.venue,raceNo:race.race_no},{...deps,tablesEnsured:true}):{...await discoverResultSource(db,deps),policy:RICH_POLICY};
}
