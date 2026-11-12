import {targetInput} from './race-history-assessment-v3.31.0.js';
import {sha256} from './card-evidence.js';
import {supplementaryRosterUrl,expectedRosterSourceUrl} from './missing-roster-acquisition.js';

// Explicit single-receipt READ. No DDL, source fetch, parser relaxation or retry.
export async function readMissingRosterEvidence(db,input){
 const target=targetInput(input),key=`${target.date}:${target.venue}:${target.raceNo}`;
 let row;
 try{row=await db.prepare(`SELECT q.*,p.race_date,p.venue,p.race_no,p.meeting_no,p.day_no FROM lab_missing_roster_sources_v1 q LEFT JOIN jra_race_program p ON p.program_key=q.race_key WHERE q.race_key=? LIMIT 1`).bind(key).first();}
 catch(e){if(!/no such table/.test(String(e)))throw e;return{ok:true,available:false,status:'source-evidence-not-recorded',target};}
 if(!row)return{ok:true,available:false,status:'source-evidence-not-recorded',target};
 const html=row.body_html,hasBody=typeof html==='string'&&html.length>0;
 const expectedUrls=row.race_date?[supplementaryRosterUrl(row),expectedRosterSourceUrl(row)]:[],expectedUrl=expectedUrls.includes(row.source_url)?row.source_url:(expectedUrls[1]||expectedUrls[0]||null),id=expectedUrl?new URL(expectedUrl).searchParams.get('race_id'):null;
 let error=row.error||null,responseEvidence=null;try{const saved=JSON.parse(row.error);if(saved?.version==='supplementary-http-failure-v1'&&saved.responseEvidence?.httpStatus===row.http_status){error=saved.message;responseEvidence=saved.responseEvidence;}}catch{}
 const result={ok:true,available:true,target,status:row.status,sourceUrl:row.source_url,expectedUrl,sourceUrlMatches:expectedUrls.includes(row.source_url),programIdentity:row.race_date?{date:row.race_date,venue:row.venue,raceNo:row.race_no,meetingNo:row.meeting_no,dayNo:row.day_no}:null,httpStatus:row.http_status,observedAt:row.observed_at,nextAttemptAt:row.next_at?new Date(Number(row.next_at)).toISOString():null,error,bodyAvailable:hasBody,bodySha256:row.body_sha256||null,charsetRecorded:!!responseEvidence?.charset,finalResponseUrlRecorded:!!responseEvidence?.responseUrl,...(responseEvidence?{responseEvidence}:{}),externalRequests:0,readOnly:true};
 if(!hasBody)return result;
 const bytes=new TextEncoder().encode(html).length;if(bytes>6000000)throw Error('Stored source evidence exceeds read bound');
 const hash=await sha256(html);if(!row.body_sha256||hash!==row.body_sha256)throw Error('Stored supplementary source hash mismatch');
 const plain=html.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
 return{...result,integrityVerified:true,bodyBytes:bytes,expectedUrl,sourceUrlMatches:expectedUrls.includes(row.source_url),
  parserIdentityChecks:{raceId:id?html.includes('race_id='+id):null,date:html.includes('kaisai_date='+target.date.replaceAll('-','')),meeting:row.meeting_no&&row.day_no?plain.replace(/\s/g,'').includes(row.meeting_no+'回'+target.venue+row.day_no+'日'):null},
  title:html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,' ').slice(0,500)||null,
  observedRaceIds:[...new Set([...html.matchAll(/race_id=(\d{12})/g)].map(m=>m[1]))].slice(0,64),
  observedCalendarDates:[...new Set([...html.matchAll(/kaisai_date=(\d{8})/g)].map(m=>m[1]))].slice(0,32),
  replacementCharacters:(html.match(/\uFFFD/g)||[]).length,declaredCharsets:[...new Set([...html.matchAll(/charset\s*=\s*["']?([\w-]+)/gi)].map(m=>m[1]))].slice(0,8),
  textExcerpt:plain.slice(0,2000),...(input.includeBody===true?{bodyHtml:html}:{})};
}
