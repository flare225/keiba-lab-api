import {sha256} from './card-evidence.js';
import {extractProfileLinks} from './collection-profile-parser-v3.32.0.js';
import {parseConfirmedPredraw} from './confirmed-predraw-roster.js';
// Decode only the selected horse's cells. Never inspect neighbouring rows.
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function storedCardPriorCells(html,{horseName,profileUrl,beforeDate}){
 const wanted=new URL(profileUrl),out=[];
 for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=m[1],name=row.match(/class=["']name_line["'][\s\S]*?class=["']name["'][\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if(!name||text(name[2])!==horseName)continue;
  const actual=new URL(name[1].replace(/&amp;/g,'&'),profileUrl);
  if(actual.origin!==wanted.origin||actual.pathname!==wanted.pathname||actual.searchParams.get('CNAME')!==wanted.searchParams.get('CNAME'))throw Error('Stored card horse identity mismatch');
  const records=[...row.matchAll(/<div\b[^>]*class=["']cell result["'][^>]*>\s*\((\d+)\.(\d+)\.(\d+)\.(\d+)\)\s*<\/div>/gi)];
  const record=records.length===1?records[0]:null;
  const observedCareerStarts=record?record.slice(1).reduce((n,x)=>n+Number(x),0):null;
  for(const c of row.matchAll(/<td\b[^>]*class=["']past\s+p[1-4][^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)){
   const cell=c[1],d=cell.match(/class=["']date["'][^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
   if(!d)continue;
   const raceDate=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
   if(raceDate>=beforeDate)continue;
   out.push({horseName,raceDate,cellHtml:cell,...(observedCareerStarts!==null?{observedCareerStarts}:{})});
  }
 }
 return out;
}

const field=(s,c)=>text(s.match(new RegExp('class=["\']'+c+'["\'][^>]*>([\\s\\S]*?)</(?:div|span|p)>'))?.[1]);
export function decodeStoredCardPriors(cells,sourceUrl){
 return cells.map(({horseName,raceDate,cellHtml:s})=>{
  const course=field(s,'dist').match(/^(\d{3,4})(芝|ダ|ダート)$/),finish=field(s,'place').replace(/\s*着$/, ''),size=field(s,'max').match(/^\d+/);
  const venue=field(s,'rc'),raceName=field(s,'name');
  if(!course||!/^\d+$/.test(finish)||!size||!venue||!raceName)return null;
  const finishPosition=Number(finish),fieldSize=Number(size[0]);if(finishPosition<1||finishPosition>fieldSize||fieldSize>28)return null;
  const timeText=field(s,'time'),last=s.match(/class=["']f3["'][^>]*>\s*3F\s*([\d.]+)/);
  return {horseName,raceDate,venue,raceName,surface:course[2]==='芝'?'芝':'ダート',distance:Number(course[1]),finishPosition,fieldSize,jockey:field(s,'jockey')||null,assignedWeight:parseFloat(field(s,'weight'))||null,bodyWeight:parseFloat(field(s,'h_weight'))||null,bodyWeightChange:null,timeText:/^\d+:\d{2}\.\d$/.test(timeText)?timeText:null,last3f:last?Number(last[1]):null,cornerPositions:null,trackCondition:field(s,'condition')||null,sourceUrl};
 }).filter(Boolean).sort((a,b)=>b.raceDate.localeCompare(a.raceDate));
}
// Only a body bound to current strict official-card or confirmed pre-draw
// evidence is eligible. A candidate/partial supplementary roster is not enough.
// This is called inside the existing collector lease; no network or new writer.
export async function readStoredCardPriors(db,context,item,limit,{includeProfileLink=false}={}){
 const race=context.race;if(!race.source_url||!race.race_key||!/^\d{4}-\d{2}-\d{2}$/.test(race.race_date))return null;
 let row;
 try{
  if(context.rosterBasis==='confirmed-predraw'){
   const source=new URL(race.source_url),literal=source.href.replace(/%2F/gi,'/');source.searchParams.set('CNAME',source.searchParams.get('CNAME'));const encoded=source.href;
   // Match both separator spellings used by historical receipts, never a
   // guessed page. Require the same source SHA and observation as the roster.
   row=await db.prepare(`SELECT b.body_html,b.byte_length,r.source_sha256,r.runners_json,r.checked_at,b.observed_at FROM lab_confirmed_predraw_rosters r JOIN lab_shared_page_bodies_v1 b ON b.page_url IN (?,?) AND b.sha256=r.source_sha256 AND b.scope_key=? AND b.http_status=200 WHERE r.race_key=? AND r.source_url=? LIMIT 1`).bind(literal,encoded,race.race_date,`${race.race_date}:${race.venue}:${race.race_no}`,race.source_url).first();
  }else row=await db.prepare(`SELECT b.body_html,b.byte_length,e.source_sha256 FROM lab_card_source_evidence e JOIN jra_races r ON r.race_key=e.race_key AND r.fetched_at=e.card_fetched_at JOIN lab_shared_page_bodies_v1 b ON b.page_url=e.source_url AND b.sha256=e.source_sha256 AND b.scope_key=r.race_date WHERE e.race_key=? AND e.source_url=? AND e.horse_numbers_observed=1 AND e.frames_observed=1 AND e.declared_count=r.runner_count AND e.parsed_count=r.runner_count LIMIT 1`).bind(race.race_key,race.source_url).first();
 }catch(e){if(/no such table/.test(String(e)))return null;throw e;}
 if(!row)return null;
 if(new TextEncoder().encode(row.body_html).length!==row.byte_length||await sha256(row.body_html)!==row.source_sha256)throw Error('Stored prior source hash mismatch');
 if(context.rosterBasis==='confirmed-predraw'){
  const parsed=parseConfirmedPredraw(row.body_html,race.source_url,{date:race.race_date,venue:race.venue,raceNo:race.race_no},{allowUnassignedConnections:true});
  if(!Number.isFinite(Date.parse(row.checked_at))||Date.parse(row.checked_at)!==Number(row.observed_at)||JSON.stringify(parsed.runners)!==row.runners_json||!parsed.runners.some(r=>r.horse_name===item.horseName&&r.age===item.age))throw Error('Stored pre-draw prior identity mismatch');
 }
 const profileUrl=extractProfileLinks(row.body_html,[item.horseName],race.source_url).get(item.horseName);if(!profileUrl)return null;
 const cells=storedCardPriorCells(row.body_html,{horseName:item.horseName,profileUrl,beforeDate:race.race_date});
 const performances=decodeStoredCardPriors(cells,race.source_url).filter(p=>p.raceDate>=item.fromDate).filter((p,i,all)=>all.findIndex(q=>q.raceDate===p.raceDate&&q.venue===p.venue&&q.raceName===p.raceName)===i).slice(0,limit);
 // Fewer than three visible cells alone do not prove a short career. Require
 // the same horse's explicit official career total and every prior to decode.
 const shortCareer=performances.length>0&&performances.length<limit&&performances.length<3&&cells.length===performances.length&&cells.every(c=>c.observedCareerStarts===performances.length);
 return performances.length>=limit||shortCareer?{profileUrl,performances,sourceSha256:row.source_sha256,...(shortCareer?{coverageBasis:'observed-short-career-record'}:{})}:includeProfileLink?{profileUrl,performances:null,sourceSha256:row.source_sha256}:null;
}

