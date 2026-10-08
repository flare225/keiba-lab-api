import {metaFromRacecardUrl} from './index-v1.1.4.js';
import {sha256} from './card-evidence.js';
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const cell=(row,name)=>row.match(new RegExp('<td\\b[^>]*class=["\']'+name+'["\'][^>]*>([\\s\\S]*?)</td>','i'))?.[1];
export function parseConfirmedPredraw(html,url,target){
 const u=new URL(url),meta=metaFromRacecardUrl(url);
 if(u.origin!=='https://www.jra.go.jp'||u.pathname!=='/JRADB/accessD.html'||!meta||meta.date!==target.date||meta.venue!==target.venue||meta.raceNo!==Number(target.raceNo))throw Error('Confirmed roster source identity mismatch');
 const table=html.match(/<table\b[^>]*>[\s\S]*?class=["']horse["'][\s\S]*?<\/table>/i)?.[0];
 const header=table?.split(/<thead\b/i)[0]||'',date=target.date.split('-').map(Number);
 if(!plain(header).includes(`${date[0]}年${date[1]}月${date[2]}日`)||!plain(header).includes(target.venue)||!new RegExp('alt=["\']'+target.raceNo+'レース["\']').test(header))throw Error('Confirmed roster page header mismatch');
 const raw=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]).filter(r=>cell(r,'horse')!==undefined);
 const runners=raw.map(row=>{
  if(cell(row,'num')===undefined||cell(row,'waku')===undefined||plain(cell(row,'num'))||plain(cell(row,'waku'))||/<img\b/i.test(cell(row,'waku')))throw Error('Not a pre-draw roster');
  const horse=cell(row,'horse'),j=cell(row,'jockey')||'',nameBlock=horse.match(/<div class=["']name["']>([\s\S]*?)<\/div>/i)?.[1]||'',link=nameBlock.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  const age=plain(j.match(/<p class=["']age["']>([\s\S]*?)<\/p>/i)?.[1]).match(/^([牡牝セ騸])(\d{1,2})\//);
  const weight=Number(plain(j.match(/<p class=["']weight["']>([\s\S]*?)<\/p>/i)?.[1]).replace(/\s*kg$/i,''));
  const jockey=plain(j.match(/<p class=["']jockey["']>([\s\S]*?)<\/p>/i)?.[1]);
  if(!link||!age||!jockey||!Number.isFinite(weight)||weight<40||weight>70)throw Error('Incomplete confirmed runner');
  const profile=new URL(link[1].replace(/&amp;/g,'&'),url);
  if(profile.origin!==u.origin||profile.pathname!=='/JRADB/accessU.html'||!/^pw01dud00\d{10}\//.test(profile.searchParams.get('CNAME')||''))throw Error('Invalid confirmed profile');
  return {horse_name:plain(link[2]),age:Number(age[2]),sex:age[1],jockey,assigned_weight:weight,profile_url:profile.href,horse_no:null,frame_no:null};
 });
 const cells=[...table.matchAll(/<td\b[^>]*class=["']horse["']/gi)].length;
 if(!runners.length||runners.length>18||cells!==runners.length||new Set(runners.map(r=>r.horse_name)).size!==runners.length)throw Error('Incomplete or duplicate confirmed roster');
 return {raceKey:`${target.date}:${target.venue}:${target.raceNo}`,sourceUrl:url,runners};
}
export async function saveConfirmedPredraw(db,html,url,target){
 const roster=parseConfirmedPredraw(html,url,target);
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_confirmed_predraw_rosters(race_key TEXT PRIMARY KEY,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,runners_json TEXT NOT NULL,checked_at TEXT NOT NULL)').run();
 await db.prepare('INSERT OR REPLACE INTO lab_confirmed_predraw_rosters VALUES(?,?,?,?,?)').bind(roster.raceKey,url,await sha256(html),JSON.stringify(roster.runners),new Date().toISOString()).run();
 return roster;
}
export async function readConfirmedPredraw(db,target){
 try{const r=await db.prepare('SELECT * FROM lab_confirmed_predraw_rosters WHERE race_key=?').bind(`${target.date}:${target.venue}:${target.raceNo}`).first();return r?{...r,runners:JSON.parse(r.runners_json)}:null;}catch(e){if(/no such table/.test(String(e)))return null;throw e;}
}
