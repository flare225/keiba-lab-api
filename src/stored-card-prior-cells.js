import {sha256} from './card-evidence.js';
import {extractProfileLinks} from './collection-profile-parser-v3.32.0.js';
// Decode only the selected horse's cells. Never inspect neighbouring rows.
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function storedCardPriorCells(html,{horseName,profileUrl,beforeDate}){
 const wanted=new URL(profileUrl),out=[];
 for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=m[1],name=row.match(/class=["']name_line["'][\s\S]*?class=["']name["'][\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if(!name||text(name[2])!==horseName)continue;
  const actual=new URL(name[1].replace(/&amp;/g,'&'),profileUrl);
  if(actual.origin!==wanted.origin||actual.pathname!==wanted.pathname||actual.searchParams.get('CNAME')!==wanted.searchParams.get('CNAME'))throw Error('Stored card horse identity mismatch');
  for(const c of row.matchAll(/<td\b[^>]*class=["']past\s+p[1-4][^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)){
   const cell=c[1],d=cell.match(/class=["']date["'][^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
   if(!d)continue;
   const raceDate=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
   if(raceDate>=beforeDate)continue;
   out.push({horseName,raceDate,cellHtml:cell});
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
// Only a body bound to the current strict official-card evidence is eligible.
// This is called inside the existing collector lease; no network or new writer.
export async function readStoredCardPriors(db,context,item,limit){
 const race=context.race;if(!race.source_url||!race.race_key||!/^\d{4}-\d{2}-\d{2}$/.test(race.race_date))return null;
 let row;
 try{row=await db.prepare(`SELECT b.body_html,b.byte_length,e.source_sha256 FROM lab_card_source_evidence e JOIN jra_races r ON r.race_key=e.race_key AND r.fetched_at=e.card_fetched_at JOIN lab_shared_page_bodies_v1 b ON b.page_url=e.source_url AND b.sha256=e.source_sha256 AND b.scope_key=r.race_date WHERE e.race_key=? AND e.source_url=? AND e.horse_numbers_observed=1 AND e.frames_observed=1 AND e.declared_count=r.runner_count AND e.parsed_count=r.runner_count LIMIT 1`).bind(race.race_key,race.source_url).first();}catch(e){if(/no such table/.test(String(e)))return null;throw e;}
 if(!row)return null;
 if(new TextEncoder().encode(row.body_html).length!==row.byte_length||await sha256(row.body_html)!==row.source_sha256)throw Error('Stored prior source hash mismatch');
 const profileUrl=extractProfileLinks(row.body_html,[item.horseName],race.source_url).get(item.horseName);if(!profileUrl)return null;
 const performances=decodeStoredCardPriors(storedCardPriorCells(row.body_html,{horseName:item.horseName,profileUrl,beforeDate:race.race_date}),race.source_url).filter(p=>p.raceDate>=item.fromDate).filter((p,i,all)=>all.findIndex(q=>q.raceDate===p.raceDate&&q.venue===p.venue&&q.raceName===p.raceName)===i).slice(0,limit);
 // A partial card cannot mark profile collection complete or suppress fallback.
 return performances.length>=limit?{profileUrl,performances,sourceSha256:row.source_sha256}:null;
}
