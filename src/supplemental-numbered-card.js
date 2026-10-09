import {sha256} from './card-evidence.js';
import {readConfirmedPredraw} from './confirmed-predraw-roster.js';
import {ensureCollectionTables} from './history-collection-v3.37.0.js';
export const TARGET={date:'2026-10-11',venue:'東京',raceNo:11,raceName:'アイルランドT',sourceUrl:'https://race.netkeiba.com/race/shutuba.html?race_id=202605040411'};
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function parseSupplementalCard(html){
 const title=plain(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]).normalize('NFKC');
 if(!title.includes('2026年10月11日 東京11R')||!title.includes('アイルランドT'))throw Error('対象レースの見出しが一致しません。');
 const count=plain(html.match(/<div class="RaceData02">([\s\S]*?)<\/div>/)?.[1]).match(/(\d+)頭/);
 const rows=[...html.matchAll(/<tr\b(?=[^>]*class="HorseList")(?=[^>]*id="tr_\d+")[^>]*>([\s\S]*?)<\/tr>/g)];
 const runners=rows.map(([,row])=>{
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1])),age=cells[4]?.match(/^([牡牝セ])(\d+)$/);
  return {frameNo:Number(cells[0]),horseNo:Number(cells[1]),horseName:cells[3],sex:age?.[1],age:Number(age?.[2]),assignedWeight:Number(cells[5]),jockey:cells[6]};
 });
 if(!count||Number(count[1])!==runners.length||runners.length<1||runners.length>18||new Set(runners.map(r=>r.horseName)).size!==runners.length||runners.some((r,i)=>r.horseNo!==i+1||!Number.isInteger(r.frameNo)||r.frameNo<1||r.frameNo>8||!r.horseName||!r.jockey||!Number.isInteger(r.age)||r.age<2||r.age>20||!Number.isFinite(r.assignedWeight)||r.assignedWeight<40||r.assignedWeight>70))throw Error('頭数・馬番・枠番・馬情報を確認できません。');
 return runners;
}
export async function readSupplementalCard(db){
 try{const r=await db.prepare('SELECT card_json FROM lab_supplemental_numbered_cards WHERE race_key=?').bind('2026-10-11:東京:11').first();return r?JSON.parse(r.card_json):null;}catch(e){if(/no such table/.test(String(e)))return null;throw e;}
}
export async function collectSupplementalCard(db){
 await ensureCollectionTables(db);const stamp=Date.now(),token=crypto.randomUUID();
 const claim=await db.prepare("UPDATE lab_history_collection_budget SET locked_until=?,lock_token=? WHERE name='jra-history' AND locked_until<=? AND next_batch_at<=?").bind(stamp+120000,token,stamp,stamp).run();
 if(Number(claim.meta?.changes)!==1)return {ok:true,status:'cooldown',externalRequests:0};
 let pause=60000;
 try{
  const r=await fetch(TARGET.sourceUrl,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok){if([403,429,503].includes(r.status))pause=3600000;throw Error('netkeiba HTTP '+r.status);}
  const bytes=await r.arrayBuffer();if(bytes.byteLength>2000000)throw Error('ページサイズが上限を超えました。');
  let html=new TextDecoder('utf-8').decode(bytes);if(html.includes('\uFFFD'))html=new TextDecoder('euc-jp').decode(bytes);
  const runners=parseSupplementalCard(html),confirmed=await readConfirmedPredraw(db,TARGET);
  if(!confirmed||confirmed.runners.length!==runners.length||runners.some(r=>!confirmed.runners.some(c=>c.horse_name===r.horseName&&c.age===r.age)))throw Error('保存済みJRA出走馬との馬名・年齢照合が一致しません。');
  const card={...TARGET,provider:'netkeiba',checkedAt:new Date().toISOString(),sourceSha256:await sha256(html),runnerCount:runners.length,runners,rosterMatchedToJra:true,officialNumberVerification:false,eligibleForProspectiveSeal:false};
  await db.prepare('CREATE TABLE IF NOT EXISTS lab_supplemental_numbered_cards(race_key TEXT PRIMARY KEY,card_json TEXT NOT NULL)').run();
  await db.prepare('INSERT OR REPLACE INTO lab_supplemental_numbered_cards VALUES(?,?)').bind('2026-10-11:東京:11',JSON.stringify(card)).run();
  return {ok:true,status:'supplemental-card-saved',externalRequests:1,card};
 }finally{await db.prepare("UPDATE lab_history_collection_budget SET locked_until=0,lock_token=NULL,next_batch_at=? WHERE name='jra-history' AND lock_token=?").bind(Date.now()+pause,token).run();}
}
export function supplementalCardPage(card){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>アイルランドT 補完出馬表</title><style>body{font:16px system-ui;background:#081018;color:#f4f7fa;margin:20px;line-height:1.7}a{color:#8fcaff}article{padding:12px;border-bottom:1px solid #345}small{color:#b7c7d5}</style><a href="https://keiba-lab-apl.vercel.app/">← アプリのホーム</a><h1>アイルランドT</h1><p>10月11日 東京11R・netkeiba掲載の枠順</p><p>馬名・年齢は保存済みJRA出走馬と照合済み。枠番・馬番はJRA未照合です。</p>'+(card?'<small>取得：'+esc(card.checkedAt)+'</small>'+card.runners.map(r=>'<article><b>'+r.frameNo+'枠 '+r.horseNo+'番 '+esc(r.horseName)+'</b><br>'+esc(r.sex)+r.age+'・'+r.assignedWeight+'kg・'+esc(r.jockey)+'</article>').join('')+'<p><a href="'+esc(card.sourceUrl)+'">出典：netkeiba</a></p>':'<p>補完カードは未保存です。</p>')+'</html>';
}
