import {sha256} from './card-evidence.js';
import {saveExpectedRoster} from './expected-roster-registry.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
const CODES={'札幌':'01','函館':'02','福島':'03','新潟':'04','東京':'05','中山':'06','中京':'07','京都':'08','阪神':'09','小倉':'10'};
const text=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const FAILURE_BYTES=65536;
async function failureResponseEvidence(response,url,stamp){
 const contentType=(response.headers.get('content-type')||'').slice(0,256),charset=contentType.match(/charset=([\w-]+)/i)?.[1]||'euc-jp';
 const evidence={version:'supplementary-http-failure-v1',requestUrl:url,requestMethod:'GET',requestRedirect:'manual',responseUrl:response.url||null,httpStatus:response.status,contentType,charset,charsetSource:/charset=/i.test(contentType)?'response-header':'existing-euc-jp-fallback',observedAt:new Date(stamp).toISOString(),maxRawBytes:FAILURE_BYTES,rawBytesStored:0,bodyComplete:false};
 let reader,body=null;
 try{
  reader=response.body?.getReader();const chunks=[];let size=0;
  if(!reader)evidence.bodyComplete=true;
  else for(;;){const part=await reader.read();if(part.done){evidence.bodyComplete=true;break;}const take=part.value.subarray(0,FAILURE_BYTES-size);chunks.push(take);size+=take.length;if(take.length<part.value.length){await reader.cancel();break;}}
  evidence.rawBytesStored=size;const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  body=new TextDecoder(charset).decode(bytes);evidence.storedDecodedBodySha256=await sha256(body);
 }catch(e){evidence.bodyReadError=String(e.message||e).slice(0,300);try{await reader?.cancel();}catch{}}
 return{body,evidence};
}
export function supplementaryRosterUrl(program){
 if(!CODES[program.venue]||!Number.isInteger(program.meeting_no)||program.meeting_no<1||program.meeting_no>12||!Number.isInteger(program.day_no)||program.day_no<1||program.day_no>12)throw Error('保存済み開催回・日次を確認できません。');
 const id=program.race_date.slice(0,4)+CODES[program.venue]+String(program.meeting_no).padStart(2,'0')+String(program.day_no).padStart(2,'0')+String(program.race_no).padStart(2,'0');return'https://race.netkeiba.com/race/shutuba.html?race_id='+id;
}
// OWN publishes the expected runner list as server-rendered HTML. Keep this
// separate from the numbered/formal card route and use the existing single
// natural-source request slot only.
export function expectedRosterSourceUrl(program){
 const legacy=supplementaryRosterUrl(program),id=new URL(legacy).searchParams.get('race_id');
 return'https://own.netkeiba.com/race/shutuba.html?race_id='+id;
}
export function parseOwnExpectedRoster(html,program,url){
 const expectedUrl=expectedRosterSourceUrl(program),u=new URL(url),id=u.searchParams.get('race_id');
 if(u.origin!=='https://own.netkeiba.com'||u.pathname!=='/race/shutuba.html'||url!==expectedUrl||!/^\d{12}$/.test(id||''))throw Error('補助名簿の取得先・対象レースを確認できません。');
 const [,month,day]=program.race_date.split('-'),dateLabel=`${Number(month)}/${Number(day)}`;
 // The OWN page is server-rendered; its race header must itself show the
 // requested calendar date, venue and race number before runner rows are read.
 const tableMarker=html.indexOf('競馬新聞');
 if(tableMarker<0)throw Error('補助名簿の開催見出しを確認できません。');
 const heading=text(html.slice(0,tableMarker));
 if(!heading.includes(dateLabel)||!heading.includes(program.venue)||!new RegExp(`(?:^|\\s)${Number(program.race_no)}R(?:\\s|$)`).test(heading))throw Error('補助名簿の開催日・開催場・レース番号を確認できません。');
 const endMarker=html.indexOf('※結果',tableMarker),section=html.slice(tableMarker,endMarker>tableMarker?endMarker:undefined);
 const anchors=[...section.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>{
  let profile=false;try{const link=new URL(m[2],'https://own.netkeiba.com');profile=(link.hostname==='own.netkeiba.com'&&link.pathname==='/db/horse.html'&&/^\d+$/.test(link.searchParams.get('id')||''))||(link.hostname==='db.netkeiba.com'&&/^\/horse\/\d+\/?$/.test(link.pathname));}catch{}
  return{match:m,profile,name:text(m[3])};
 }).filter(x=>x.profile);
 if(!anchors.length)throw Error('補助出馬表の名簿公開を確認できません。');
 const runners=[];
 for(let i=0;i<anchors.length;i++){
  const current=anchors[i],start=current.match.index+current.match[0].length,next=anchors[i+1]?.match.index??section.length,tail=text(section.slice(start,next)),age=tail.match(/[牡牝セ騸]\s*(\d{1,2})(?:\s|$)/);
  if(!current.name||current.name.length>40||!age||Number(age[1])<2||Number(age[1])>15)throw Error('補助名簿の馬名・年齢を確認できません。');
  runners.push({horseName:current.name,age:Number(age[1])});
 }
 if(runners.length>100||new Set(runners.map(r=>r.horseName)).size!==runners.length)throw Error('補助名簿の頭数・重複を確認できません。');
 return runners;
}
export function parseSupplementaryRoster(html,program,url){
 if(new URL(url).hostname==='own.netkeiba.com')return parseOwnExpectedRoster(html,program,url);
 const id=new URL(url).searchParams.get('race_id'),flat=text(html),digits=program.race_date.replaceAll('-','');
 // A URL alone is not evidence of a matching meeting/date.
 if(!html.includes('race_id='+id)||!html.includes('kaisai_date='+digits)||!flat.replace(/\s/g,'').includes(program.meeting_no+'回'+program.venue+program.day_no+'日'))throw Error('補助名簿の開催日・開催場を確認できません。');
 const runners=[];for(const match of html.matchAll(/<tr\b[^>]*class=["'][^"']*\bHorseList\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=match[1],horse=row.match(/<a\b[^>]*href=["']https:\/\/db\.netkeiba\.com\/horse\/\d+\/?["'][^>]*>([\s\S]*?)<\/a>/i),age=text(row).match(/[牡牝セ騸]\s*(\d{1,2})(?:\s|$)/);if(!horse||!age)throw Error('補助名簿の馬名・年齢を確認できません。');const horseName=text(horse[1]);if(!horseName||horseName.length>40||Number(age[1])<2||Number(age[1])>15)throw Error('補助名簿の馬名・年齢が不正です。');runners.push({horseName,age:Number(age[1])});
 }
 if(!runners.length||runners.length>100||new Set(runners.map(r=>r.horseName)).size!==runners.length)throw Error('補助出馬表の名簿公開を確認できません。');return runners;
}
export async function collectMissingRoster(db,input=null,{now=Date.now,fetcher=fetch}={}){
 const stamp=now(),today=new Date(stamp+9*3600000).toISOString().slice(0,10),until=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10);if(input)targetInput(input);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_missing_roster_sources_v1(race_key TEXT PRIMARY KEY,status TEXT NOT NULL,next_at INTEGER NOT NULL,source_url TEXT,http_status INTEGER,body_sha256 TEXT,body_html TEXT,observed_at TEXT,error TEXT)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_missing_roster_clock_v1(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)').run();await db.prepare("INSERT OR IGNORE INTO lab_missing_roster_clock_v1 VALUES('source',0)").run();
 const clock=await db.prepare("SELECT next_at FROM lab_missing_roster_clock_v1 WHERE name='source'").first();if(Number(clock.next_at)>stamp)return{status:'source-not-due',externalRequests:0,nextAttemptAt:new Date(clock.next_at).toISOString()};
 const pending=await db.prepare("SELECT race_key FROM lab_missing_roster_sources_v1 WHERE status='pending-roster-readback' AND next_at<=? ORDER BY next_at LIMIT 1").bind(stamp).first();
 if(pending){
  const stored=await db.prepare('SELECT snapshot_id,record_json,stored_at FROM lab_expected_roster_registry WHERE race_key=? ORDER BY stored_at DESC LIMIT 1').bind(pending.race_key).first();
  if(stored){
   if(await sha256(stored.record_json)!==stored.snapshot_id)throw Error('名簿再照合ハッシュ不一致');
   const record=JSON.parse(stored.record_json),runners=record.runners;
   if(`${record.date}:${record.venue}:${record.raceNo}`!==pending.race_key||!Array.isArray(runners)||!runners.length||runners.length>100||new Set(runners.map(r=>r.horseName)).size!==runners.length)throw Error('名簿再照合の対象・頭数不一致');
   await db.prepare("UPDATE lab_missing_roster_sources_v1 SET status='roster-saved',error=NULL WHERE race_key=?").bind(pending.race_key).run();
   return{status:'roster-reconciled',target:pending.race_key,snapshotId:stored.snapshot_id,snapshotSha256:stored.snapshot_id,savedAt:stored.stored_at,storedRunners:runners.length,newRosterRaces:0,externalRequests:0,independentRosterReadback:true,formalCardSaved:false};
  }
 }
 // Keep published official cards first from Thursday afternoon onward.
 if([4,5,6,0].includes(new Date(stamp+9*3600000).getUTCDay())&&(new Date(stamp+9*3600000).getUTCDay()!==4||new Date(stamp+9*3600000).getUTCHours()>=15))return{status:'official-card-priority',externalRequests:0};
 const filter=input?' AND p.race_date=? AND p.venue=? AND p.race_no=?':'';
 const args=[today,until,stamp,...(input?[input.date,input.venue,Number(input.raceNo??input.race_no)]:[])];
 const p=await db.prepare(`SELECT p.*,q.body_html,q.body_sha256,q.observed_at,q.status source_status FROM jra_race_program p LEFT JOIN lab_missing_roster_sources_v1 q ON q.race_key=p.race_date||':'||p.venue||':'||p.race_no WHERE p.race_date>? AND p.race_date<=? AND COALESCE(q.next_at,0)<=? AND NOT EXISTS(SELECT 1 FROM lab_expected_roster_registry r WHERE r.race_key=p.race_date||':'||p.venue||':'||p.race_no) AND NOT EXISTS(SELECT 1 FROM jra_races r WHERE r.race_date=p.race_date AND r.venue=p.venue AND r.race_no=p.race_no AND r.runner_count>0 AND r.runner_count=(SELECT COUNT(*) FROM jra_runners x WHERE x.race_key=r.race_key))${filter} ORDER BY COALESCE(q.next_at,0),p.race_date,p.race_no,p.venue LIMIT 1`).bind(...args).first();if(!p)return{status:'no-due-missing-roster',externalRequests:0};
 const key=`${p.race_date}:${p.venue}:${p.race_no}`;let url;try{url=expectedRosterSourceUrl(p)}catch(e){await db.prepare('INSERT INTO lab_missing_roster_sources_v1(race_key,status,next_at,error) VALUES(?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error').bind(key,'program-identity-incomplete',stamp+6*3600000,String(e.message)).run();return{status:'program-identity-incomplete',target:key,externalRequests:0};}
 const gate=await db.prepare("SELECT next_batch_at,locked_until FROM lab_history_collection_budget WHERE name='jra-history'").first();if(!gate)return{status:'shared-gate-unavailable',externalRequests:0};const wait=Math.max(Number(gate.next_batch_at)||0,Number(gate.locked_until)||0);if(wait>stamp)return{status:'cooldown',target:key,externalRequests:0,nextAttemptAt:new Date(wait).toISOString()};
 const token=crypto.randomUUID(),lease=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND next_batch_at<=? AND locked_until<=?").bind(stamp+120000,token,stamp,stamp).run();if(Number(lease.meta?.changes)!==1)return{status:'cooldown',externalRequests:0};
 let requests=0,pause=60000,quota=false,http=null,failedResponse=null,html=['source-received','pending-roster-readback'].includes(p.source_status)?p.body_html:null,observed=p.observed_at;
 try{
 await db.prepare("UPDATE lab_missing_roster_clock_v1 SET next_at=? WHERE name='source'").bind((Math.floor(stamp/3600000)+1)*3600000).run();
 if(html){if(await sha256(html)!==p.body_sha256)throw Error('補助出典receiptのハッシュが一致しません。');}else{requests=1;const response=await fetcher(url,{redirect:'manual',headers:{accept:'text/html'},signal:AbortSignal.timeout(10000)});http=response.status;if(!response.ok){if([403,429,503].includes(http))pause=3600000;failedResponse=await failureResponseEvidence(response,url,stamp);throw Error('netkeiba HTTP '+http);}const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('補助ページサイズ上限');const charset=(response.headers.get('content-type')||'').match(/charset=([\w-]+)/i)?.[1]||'euc-jp';html=new TextDecoder(charset).decode(bytes);observed=new Date(stamp).toISOString();await db.prepare('INSERT INTO lab_missing_roster_sources_v1 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,source_url=excluded.source_url,http_status=excluded.http_status,body_sha256=excluded.body_sha256,body_html=excluded.body_html,observed_at=excluded.observed_at,error=NULL').bind(key,'source-received',stamp+3600000,url,http,await sha256(html),html,observed,null).run();}
 const runners=parseSupplementaryRoster(html,p,url),sourceText=`対象 ${p.race_date} ${p.venue}${p.race_no}R\n取得元HTML SHA256 ${await sha256(html)}\n`+runners.map(r=>r.horseName+' '+r.age+'歳').join('\n');
 const saved=await saveExpectedRoster(db,{date:p.race_date,venue:p.venue,raceNo:p.race_no,raceName:p.race_label,provider:'netkeiba',kind:'expected-runners',sourceUrl:url,observedAt:observed,sourceText,runners},stamp);
 await db.prepare("UPDATE lab_missing_roster_sources_v1 SET status='roster-saved',next_at=?,error=NULL WHERE race_key=?").bind(stamp+86400000,key).run();return{status:'roster-saved',target:key,storedRunners:runners.length,newRosterRaces:saved.idempotent?0:1,snapshotId:saved.snapshotId,externalRequests:requests,independentRosterReadback:true,formalCardSaved:false};
 }catch(e){if(e.d1DailyReadLimit||/exceeded D1.*daily row read limit/i.test(String(e))){quota=true;throw e;}const status=e.saveMayHaveSucceeded?'pending-roster-readback':[403,429,503].includes(http)?'source-blocked':/補助.*(?:確認|不正)|補助出馬表/.test(String(e.message||e))?'publication-unconfirmed':'fetch-failed';
 if(failedResponse){const f=failedResponse;await db.prepare('INSERT INTO lab_missing_roster_sources_v1 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,source_url=excluded.source_url,http_status=excluded.http_status,body_sha256=excluded.body_sha256,body_html=excluded.body_html,observed_at=excluded.observed_at,error=excluded.error').bind(key,status,stamp+3600000,url,http,f.evidence.storedDecodedBodySha256||null,f.body,f.evidence.observedAt,JSON.stringify({version:'supplementary-http-failure-v1',message:String(e.message||e),responseEvidence:f.evidence})).run();}
 else await db.prepare('INSERT INTO lab_missing_roster_sources_v1(race_key,status,next_at,source_url,http_status,error) VALUES(?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET status=excluded.status,next_at=excluded.next_at,error=excluded.error,http_status=excluded.http_status').bind(key,status,stamp+3600000,url,http,String(e.message||e)).run();
 return{status,target:key,error:String(e.message||e),sourceUrl:url,httpStatus:http,externalRequests:requests,nextAttemptAt:new Date(stamp+3600000).toISOString(),saveMayHaveSucceeded:!!e.saveMayHaveSucceeded,...(failedResponse?{failureEvidence:failedResponse.evidence}:{})};
 }finally{if(!quota)await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,lock_token=NULL,next_batch_at=? WHERE name='jra-history' AND lock_token=?").bind(now()+pause,token).run();}
}
