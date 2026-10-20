import {ensureCollectionTables,jstDay} from './history-collection-v3.37.0.js';
import {ensureProgramTable} from './index-v3.4.0.js';
import {parseArchiveProgram} from './archive-program-parser-v3.38.0.js';
import {jraPageRequest} from './jra-page-request.js';
import {sha256} from './card-evidence.js';
const TABLE='lab_program_recovery_v1',CLOCK='lab_program_recovery_clock_v1';
const quota=e=>e?.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e));
export async function recoverMissingPrograms(db,{now=Date.now,fetcher=fetch,parse=parseArchiveProgram}={}){
 const stamp=now(),today=jstDay(stamp),dates=Array.from({length:8},(_,i)=>new Date(Date.parse(today+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${CLOCK}(name TEXT PRIMARY KEY,next_attempt_at INTEGER NOT NULL)`).run();
 await db.prepare(`INSERT OR IGNORE INTO ${CLOCK} VALUES('program',0)`).run();
 const clock=await db.prepare(`SELECT next_attempt_at FROM ${CLOCK} WHERE name='program'`).first();if(Number(clock?.next_attempt_at)>stamp)return null;
 await ensureCollectionTables(db);await ensureProgramTable(db);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(date TEXT PRIMARY KEY,status TEXT NOT NULL,next_attempt_at INTEGER NOT NULL,source_json TEXT,source_sha256 TEXT,checked_at INTEGER,error TEXT)`).run();
 // Seed calendar dates independently of program rows, including weekdays/holidays.
 // A failed/empty source is unknown, never evidence of no meeting.
 await db.prepare(`INSERT OR IGNORE INTO ${TABLE}(date,status,next_attempt_at) SELECT value,'pending',0 FROM json_each(?)`).bind(JSON.stringify(dates)).run();
 const row=await db.prepare(`SELECT * FROM ${TABLE} WHERE date BETWEEN ? AND ? AND next_attempt_at<=? ORDER BY next_attempt_at,date LIMIT 1`).bind(dates[0],dates.at(-1),stamp).first();if(!row)return null;
 const gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first();const wait=Math.max(Number(gate?.next_batch_at)||0,Number(gate?.locked_until)||0);if(wait>stamp)return{ok:true,status:'cooldown',externalRequests:0,nextBatchAt:new Date(wait).toISOString()};
 const token=crypto.randomUUID(),claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();if(Number(claim.meta?.changes)!==1)return{ok:true,status:'cooldown',externalRequests:0};
 // Reserve a single hourly slot; other history invocations continue normally.
 await db.prepare(`UPDATE ${CLOCK} SET next_attempt_at=? WHERE name='program'`).bind(stamp+3600000).run();
 let requests=0,pause=60000,uncertain=false,quotaStopped=false;
 try{
  const [y,m,d]=row.date.split('-'),url=`https://www.jra.go.jp/keiba/calendar${y}/${y}/${Number(m)}/${m}${d}.html`;let evidence;
  if(row.status!=='partial-published-program'&&row.source_json&&Number(row.checked_at)>stamp-86400000){if(await sha256(row.source_json)!==row.source_sha256)throw Error('Program source receipt hash mismatch');evidence=JSON.parse(row.source_json);}
  else{
   const request=jraPageRequest(url);requests=1;const response=await fetcher(request.url,request.options);if(!response.ok){if([403,429,503].includes(response.status))pause=3600000;throw Error('JRA program HTTP '+response.status);}
   if(response.url&&response.url!==url)throw Error('Unexpected JRA program redirect');const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('Program page too large');const html=new TextDecoder(/charset\s*=\s*["']?utf-?8/i.test(response.headers.get('content-type')||'')?'utf-8':'shift_jis').decode(bytes);
   evidence={url,htmlSha256:await sha256(html),programs:parse(html,row.date,url)};
  }
  const programs=evidence.programs;
  if(!Array.isArray(programs)||!programs.length||programs.length>120||evidence.url!==url||new Set(programs.map(r=>r.programKey)).size!==programs.length||programs.some(r=>r.date!==row.date||!['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'].includes(r.venue)||!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>12||r.programKey!==`${row.date}:${r.venue}:${r.raceNo}`||r.sourceUrl!==url||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime||'')))throw Error('Program publication unknown or incomplete source identity');
  const body=JSON.stringify(evidence),hash=await sha256(body);
  // Receipt first: a failed save/readback can reuse the source without refetching.
  await db.prepare(`UPDATE ${TABLE} SET status='pending-readback',source_json=?,source_sha256=?,checked_at=?,next_attempt_at=?,error=NULL WHERE date=?`).bind(body,hash,requests?stamp:row.checked_at,stamp+3600000,row.date).run();
  const before=(await db.prepare('SELECT program_key,start_time FROM jra_race_program WHERE race_date=?').bind(row.date).all()).results||[],known=new Set(before.map(r=>r.program_key));
  const missing=programs.filter(r=>!known.has(r.programKey));uncertain=true;
  const inserted=await db.prepare("INSERT INTO jra_race_program(program_key,race_date,venue,meeting_no,day_no,race_no,race_label,surface,distance,start_time,grade,source_url,fetched_at) SELECT json_extract(value,'$.programKey'),json_extract(value,'$.date'),json_extract(value,'$.venue'),json_extract(value,'$.meetingNo'),json_extract(value,'$.dayNo'),json_extract(value,'$.raceNo'),json_extract(value,'$.raceLabel'),json_extract(value,'$.surface'),json_extract(value,'$.distance'),json_extract(value,'$.startTime'),json_extract(value,'$.grade'),json_extract(value,'$.sourceUrl'),? FROM json_each(?) WHERE 1 ON CONFLICT(program_key) DO NOTHING").bind(new Date(stamp).toISOString(),JSON.stringify(programs)).run();
  const read=(await db.prepare('SELECT * FROM jra_race_program WHERE program_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(programs.map(r=>r.programKey))).all()).results||[];
  if(read.length!==programs.length||programs.some(r=>!read.some(x=>x.program_key===r.programKey&&x.start_time===r.startTime))||missing.some(r=>{const x=read.find(x=>x.program_key===r.programKey);return !x||x.race_date!==r.date||x.venue!==r.venue||x.race_no!==r.raceNo||x.meeting_no!==(r.meetingNo??null)||x.day_no!==(r.dayNo??null)||x.race_label!==(r.raceLabel??null)||x.surface!==(r.surface??null)||x.distance!==(r.distance??null)||x.grade!==(r.grade??null)||x.source_url!==r.sourceUrl||x.fetched_at!==new Date(stamp).toISOString();}))throw Error('Program readback mismatch; existing rows preserved');uncertain=false;
  const counts=new Map();for(const r of programs)counts.set(r.venue,(counts.get(r.venue)||0)+1);const complete=[...counts.values()].every(n=>n===12),status=complete?'verified-published-program':'partial-published-program';
  await db.prepare(`UPDATE ${TABLE} SET status=?,next_attempt_at=?,error=NULL WHERE date=?`).bind(status,stamp+(complete?86400000:3600000),row.date).run();
  return{ok:true,status,date:row.date,missingDetected:missing.length,programRowsSaved:Number(inserted.meta?.changes)||0,readbackVerified:read.length,externalRequests:requests,meetingAbsenceInferred:false};
 }catch(e){if(quota(e)){quotaStopped=true;if(uncertain)e.saveMayHaveSucceeded=true;throw e;}await db.prepare(`UPDATE ${TABLE} SET status=?,next_attempt_at=?,error=? WHERE date=?`).bind(uncertain?'pending-readback':'source-unconfirmed',stamp+3600000,String(e.message||e),row.date).run();return{ok:false,status:uncertain?'pending-readback':'source-unconfirmed',date:row.date,externalRequests:requests,saveMayHaveSucceeded:uncertain,error:String(e.message||e),meetingAbsenceInferred:false};}
 finally{if(!quotaStopped)await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,lock_token=NULL,next_batch_at=? WHERE name='jra-history' AND lock_token=?").bind(now()+pause,token).run();}
}
