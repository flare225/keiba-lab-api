import {EDITORIAL_SOURCE as SOURCE,EDITORIAL_NOTES as NOTES,EDITORIAL_RACE_CHECKS as CHECKS} from './shuka-editorial-reference.js';
const TABLE='lab_editorial_reference_notes';
const payload=note=>JSON.stringify({source:SOURCE,raceChecks:CHECKS,note});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const missing=e=>/no such table/i.test(String(e));
export async function seedEditorialReferences(db,now=Date.now()){
 let count=0;try{count=Number((await db.prepare(`SELECT COUNT(*) n FROM ${TABLE} WHERE reference_id=?`).bind(SOURCE.referenceId).first())?.n||0);}catch(e){if(!missing(e))throw e;}
 if(count===NOTES.length)return {saved:count,alreadySaved:true};
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(reference_id TEXT NOT NULL,race_key TEXT NOT NULL,horse_name TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(reference_id,horse_name))`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_notes_no_update BEFORE UPDATE ON ${TABLE} BEGIN SELECT RAISE(ABORT,'editorial reference is immutable');END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_notes_no_delete BEFORE DELETE ON ${TABLE} BEGIN SELECT RAISE(ABORT,'editorial reference is immutable');END`).run();
 const statements=[];for(const note of NOTES){const body=payload(note);statements.push(db.prepare(`INSERT OR IGNORE INTO ${TABLE}(reference_id,race_key,horse_name,payload_json,payload_sha256,saved_at) VALUES(?,?,?,?,?,?)`).bind(SOURCE.referenceId,SOURCE.raceKey,note.horseName,body,await hash(body),new Date(now).toISOString()));}
 await db.batch(statements);return {saved:NOTES.length,alreadySaved:false};
}
export async function readEditorialReferences(db,input){
 if(input.date!==SOURCE.date||input.venue!==SOURCE.venue||Number(input.raceNo)!==SOURCE.raceNo)throw Error('参考資料の登録がないレースです。');
 let rows=[];try{rows=(await db.prepare(`SELECT horse_name,payload_json,payload_sha256,saved_at FROM ${TABLE} WHERE reference_id=? AND race_key=?`).bind(SOURCE.referenceId,SOURCE.raceKey).all()).results||[];}catch(e){if(!missing(e))throw e;}
 const notes=[];for(const expected of NOTES){const row=rows.find(r=>r.horse_name===expected.horseName);if(!row)continue;const body=payload(expected);if(row.payload_json!==body||row.payload_sha256!==await hash(body))throw Error('参考資料の保存内容を照合できません。');notes.push({...expected,savedAt:row.saved_at,storageIntegrityVerified:true});}
 return {ok:true,source:SOURCE,raceChecks:CHECKS,expectedNotes:NOTES.length,savedNotes:notes.length,storage:notes.length===NOTES.length?'db-saved':'not-fully-saved',notes,guardrails:{referenceOnly:true,allArticleClaimsUnverified:true,officialHistoryRowsAdded:0,scoreApplied:false,trainingCredit:false,userMarksModified:false,locksModified:false,externalRequests:0}};
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=items=>'<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
export function editorialReferencePage(data){return '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>秋華賞 参考資料 | KEIBA LABO</title><style>body{margin:0;background:#081018;color:#edf5fd;font:17px/1.75 system-ui}main{max-width:900px;margin:auto;padding:20px 16px}article{padding:20px;border:1px solid #294151;border-radius:12px;margin:20px 0;background:#101e29}a{color:#88c7ff}h1{font-size:26px}h2{font-size:22px}h3{font-size:18px}p,li{overflow-wrap:anywhere}</style></head><body><main><p><a href="https://keiba-lab-apl.vercel.app/">ホームへ戻る</a> · <a href="/lab/work-progress">補完状況</a></p><h1>秋華賞：記事からの参考メモ</h1><p>DB保存 '+data.savedNotes+' / '+data.expectedNotes+'頭。記事の主張は未照合です。正式な出走馬・過去走・脚質の認定ではなく、LABO指数と学習実績には加えていません。</p><p>出典：<a href="'+esc(data.source.sourceUrl)+'" rel="noreferrer">'+esc(data.source.sourceName)+'</a>。記事の掲載日 '+esc(data.source.sourcePublishedDate)+'、受領日 '+esc(data.source.userProvidedAt.slice(0,10))+'。</p><h2>レース全体の照合待ち</h2>'+list(data.raceChecks)+data.notes.map(n=>'<article><h2>'+esc(n.horseName)+'</h2><p>記事記載の血統（未照合）：父 '+esc(n.pedigree[0])+'／母 '+esc(n.pedigree[1])+'／母父 '+esc(n.pedigree[2])+'</p><h3>記事が述べる実績（未照合）</h3>'+list(n.reportedFacts)+'<h3>記事の評価・懸念点</h3>'+list(n.editorialViews)+(n.checks.length?'<h3>個別の照合待ち</h3>'+list(n.checks):'')+'</article>').join('')+'</main></body></html>';}
