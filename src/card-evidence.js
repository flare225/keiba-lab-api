// Strict source checks for ingestion and prospective LOCK. Do not infer missing numbers.
import {extractRunners} from './index-v1.1.4.js';
const plain=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
export async function sha256(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function inspectSourceCard(html){
 const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>x[1]).filter(x=>/父：/.test(plain(x))&&/母：/.test(plain(x)));
 const raw=extractRunners(html),frames=new Map();let lastFrame=null;
 for(const row of rows){
  const cells=[...row.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)].map(x=>({attrs:x[1],value:plain(x[2])}));
  const numbers=cells.map(x=>x.value.match(/^(?:馬番\s*)?([1-9]|1[0-8])(?:\s*番)?$/)).filter(Boolean).map(x=>Number(x[1]));
  const frameImage=row.match(/<img\b[^>]*alt=["'](?:枠|枠番)\s*([1-8])(?:枠|白|黒|赤|青|黄|緑|橙|桃)*["']/i);
  let horseNo=null,frameNo=null;
  if(numbers.length>=2){horseNo=numbers.at(-1);frameNo=numbers[0];lastFrame=frameNo;}
  else if(numbers.length===1){horseNo=numbers[0];if(frameImage){frameNo=Number(frameImage[1]);lastFrame=frameNo;}else if(lastFrame!==null){frameNo=lastFrame;}}
  // Frame carry-forward is only authoritative when the original frame cell spans rows.
  const span=cells.find(x=>/rowspan\s*=\s*["']?\d+/i.test(x.attrs)&&/^[1-8]$/.test(x.value));
  if(span){const count=Number(span.attrs.match(/rowspan\s*=\s*["']?(\d+)/i)[1]);lastFrame={number:Number(span.value),remaining:count-1};frameNo=lastFrame.number;}
  else if(typeof lastFrame==='object'&&lastFrame!==null){if(lastFrame.remaining>0){frameNo=lastFrame.number;lastFrame.remaining--;}else{lastFrame=null;frameNo=null;}}
  else if(!frameImage&&numbers.length===1){frameNo=null;lastFrame=null;}
  if(horseNo)frames.set(horseNo,frameNo>=1&&frameNo<=8?frameNo:null);
 }
 const first=rows.length?html.indexOf(rows[0]):-1;
 // Explicit head count only; multiple conflicting labels are deliberately not accepted.
 const header=plain(html.slice(0,first<0?html.length:first));
 const counts=[...header.matchAll(/(?:出走頭数\s*[:：]?\s*|全\s*)?(\d{1,2})\s*頭/g)].map(x=>Number(x[1])).filter(x=>x>=1&&x<=18);
 const rosterTable=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(x=>/父：/.test(plain(x[1]))&&/母：/.test(plain(x[1])))?.[0]||'';
 const rosterCount=[...rosterTable.matchAll(/<td\b[^>]*class=["'][^"']*\bhorse\b[^"']*["'][^>]*>/gi)].length;
 const explicitCount=new Set(counts).size===1?counts[0]:null;
 const declaredCount=explicitCount??(counts.length===0&&rosterCount>=1&&rosterCount<=18&&/<\/table>/i.test(html)?rosterCount:null);
 const countBasis=explicitCount!==null?'explicit-label':declaredCount!==null?'official-roster-cells':'unverified';
 return {sourceRowCount:rows.length,declaredCount,countBasis,raw,frames,allHorseNumbersObserved:raw.length===rows.length&&raw.length>0&&raw.every((x,i)=>x.horseNo===i+1),allFramesObserved:raw.length>0&&raw.every(x=>Number.isInteger(frames.get(x.horseNo)))};
}
export async function ensureEvidenceTable(db){await db.prepare(`CREATE TABLE IF NOT EXISTS lab_card_source_evidence (race_key TEXT PRIMARY KEY,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,runner_sha256 TEXT NOT NULL,declared_count INTEGER,source_row_count INTEGER NOT NULL,parsed_count INTEGER NOT NULL,horse_numbers_observed INTEGER NOT NULL,frames_observed INTEGER NOT NULL,card_fetched_at TEXT NOT NULL,verified_at TEXT NOT NULL,count_basis TEXT NOT NULL DEFAULT 'unverified')`).run();}
export function runnerFingerprint(runners){return JSON.stringify(runners.map(x=>({horseNo:Number(x.horseNo??x.horse_no),frameNo:x.frameNo??x.frame_no??null,name:x.name??x.horse_name})).sort((a,b)=>a.horseNo-b.horseNo));}
export async function requireLockEvidence(db,race,runners){
 await ensureEvidenceTable(db);
 const evidence=await db.prepare('SELECT * FROM lab_card_source_evidence WHERE race_key=?').bind(race.race_key).first();
 const current=await db.prepare('SELECT fetched_at FROM jra_races WHERE race_key=?').bind(race.race_key).first();
 if(!evidence||!evidence.horse_numbers_observed||!evidence.frames_observed||evidence.declared_count!==runners.length||evidence.source_row_count!==runners.length||evidence.parsed_count!==runners.length||!current||evidence.card_fetched_at!==current.fetched_at||evidence.runner_sha256!==await sha256(runnerFingerprint(runners)))throw new Error('Prospective LOCK requires current official head count, source-observed horse/frame numbers and exact saved runner fingerprint');
 return evidence;
}
