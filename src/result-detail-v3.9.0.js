import {sha256} from './card-evidence.js';

function cleanText(value){
 return String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();
}
function cells(row){return [...String(row||'').matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>cleanText(m[1]));}
function norm(v){return String(v||'').replace(/[\s　]/g,'').replace(/[（）()]/g,'').trim();}
function number(v){const m=String(v??'').replace(/,/g,'').match(/[+-]?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
function integer(v){const n=number(v);return Number.isInteger(n)?n:null;}
function timeSeconds(v){const s=String(v||'').trim();const m=s.match(/^(\d+):(\d{2})(?:\.(\d))?$/);return m?Number(m[1])*60+Number(m[2])+Number(`0.${m[3]||0}`):null;}
function bodyWeight(v){const s=String(v||'');const w=s.match(/(\d{3})/);const c=s.match(/[（(]\s*([+-]?\d+)\s*[）)]/);return{bodyWeight:w?Number(w[1]):null,bodyWeightChange:c?Number(c[1]):null};}
function sexAge(v){const m=String(v||'').replace(/\s/g,'').match(/(牡|牝|せん)(\d+)/);return{sex:m?.[1]||null,age:m?Number(m[2]):null};}
function finish(v){const s=norm(v);const m=s.match(/^(\d{1,2})(?:着)?$/);if(m)return{position:Number(m[1]),status:'finished'};if(/中止/.test(s))return{position:null,status:'did-not-finish'};if(/取消/.test(s))return{position:null,status:'scratched'};if(/除外/.test(s))return{position:null,status:'excluded'};if(/失格/.test(s))return{position:null,status:'disqualified'};return{position:null,status:s||'unknown'};}

const ALIASES={
 finish:['着順'],frame:['枠','枠番'],horseNo:['馬番'],horseName:['馬名'],sexAge:['性齢','性年齢'],assignedWeight:['斤量'],jockey:['騎手'],time:['タイム','走破タイム'],margin:['着差'],passing:['通過','通過順位'],last3f:['上り','上がり','上り3F','上がり3F'],popularity:['人気','単勝人気'],odds:['単勝','単勝オッズ'],bodyWeight:['馬体重']
};
function headerMap(headers){
 const out={};
 headers.forEach((h,i)=>{const n=norm(h);for(const[k,aliases]of Object.entries(ALIASES)){if(out[k]!=null)continue;if(aliases.some(a=>n===norm(a)||n.startsWith(norm(a))))out[k]=i;}});
 return out;
}
function findResultTable(html){
 for(const t of String(html||'').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const rows=[...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>cells(m[1])).filter(x=>x.length);
  if(!rows.length)continue;
  for(let i=0;i<Math.min(rows.length,5);i++){
   const map=headerMap(rows[i]);
   if(map.finish!=null&&map.horseName!=null&&(map.horseNo!=null||map.frame!=null))return{rows,headerIndex:i,map,headers:rows[i]};
  }
 }
 return null;
}

export function parseOfficialResultDetails(html,expectedRunners=[]){
 const table=findResultTable(html);
 if(!table)return{ok:false,error:'official result table not found',headers:[],rows:[]};
 const expectedByName=new Map(expectedRunners.map(r=>[String(r.horse_name||r.horseName),r]));
 const expectedByNo=new Map(expectedRunners.map(r=>[Number(r.horse_no??r.horseNo),r]).filter(([n])=>Number.isInteger(n)));
 const parsed=[];
 for(const row of table.rows.slice(table.headerIndex+1)){
  const get=k=>table.map[k]==null?null:row[table.map[k]]??null;
  const name=String(get('horseName')||'').trim();
  const no=integer(get('horseNo'));
  let expected=expectedByName.get(name)||expectedByNo.get(no)||null;
  if(expectedRunners.length&&!expected)continue;
  if(!name&&!expected)continue;
  const f=finish(get('finish')),bw=bodyWeight(get('bodyWeight')),sa=sexAge(get('sexAge'));
  parsed.push({
   horseNo:Number(expected?.horse_no??expected?.horseNo??no)||null,
   frameNo:integer(get('frame')),
   horseName:String(expected?.horse_name??expected?.horseName??name),
   finishPosition:f.position,finishStatus:f.status,
   sex:sa.sex,age:sa.age,assignedWeight:number(get('assignedWeight')),jockey:get('jockey'),
   timeText:get('time'),timeSeconds:timeSeconds(get('time')),margin:get('margin'),cornerPositions:get('passing'),last3f:number(get('last3f')),
   popularity:integer(get('popularity')),odds:number(get('odds')),bodyWeight:bw.bodyWeight,bodyWeightChange:bw.bodyWeightChange
  });
 }
 const uniqueNames=new Set(parsed.map(x=>x.horseName)),uniqueNos=new Set(parsed.map(x=>x.horseNo).filter(Number.isInteger));
 const expectedNames=new Set(expectedRunners.map(r=>String(r.horse_name||r.horseName)));
 const missing=[...expectedNames].filter(n=>!uniqueNames.has(n));
 const duplicates=parsed.length-uniqueNames.size;
 const identityOk=!expectedRunners.length||(parsed.length===expectedRunners.length&&missing.length===0&&duplicates===0&&uniqueNos.size===expectedRunners.length);
 return{ok:identityOk,headers:table.headers,map:table.map,rows:parsed,identity:{expectedCount:expectedRunners.length,parsedCount:parsed.length,uniqueHorseNames:uniqueNames.size,uniqueHorseNumbers:uniqueNos.size,missingNames:missing,duplicateNameRows:duplicates,verified:identityOk}};
}

export async function ensureResultDetailTables(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS lab_race_result_details(id INTEGER PRIMARY KEY AUTOINCREMENT,race_key TEXT NOT NULL,horse_no INTEGER NOT NULL,horse_name TEXT NOT NULL,finish_position INTEGER,finish_status TEXT NOT NULL,time_text TEXT,time_seconds REAL,margin TEXT,corner_positions TEXT,last3f REAL,popularity INTEGER,odds REAL,body_weight INTEGER,body_weight_change INTEGER,jockey TEXT,assigned_weight REAL,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,fetched_at TEXT NOT NULL,UNIQUE(race_key,horse_no))`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS lab_result_ingest_revisions(revision_id TEXT PRIMARY KEY,race_key TEXT NOT NULL,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,runner_count INTEGER NOT NULL,parsed_count INTEGER NOT NULL,result_json TEXT NOT NULL,fetched_at TEXT NOT NULL,UNIQUE(race_key,source_sha256))`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_result_revision_no_update BEFORE UPDATE ON lab_result_ingest_revisions BEGIN SELECT RAISE(ABORT,'result ingest revisions are immutable'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_result_revision_no_delete BEFORE DELETE ON lab_result_ingest_revisions BEGIN SELECT RAISE(ABORT,'result ingest revisions are immutable'); END`).run();
}

export async function persistVerifiedResultDetails(db,{raceKey,runners,sourceUrl,sourceHtml,parsed,fetchedAt}){
 if(!parsed?.ok||parsed.identity?.verified!==true)throw new Error('result identity verification failed');
 if(typeof db.batch!=='function')throw new Error('atomic D1 batch support is required for result persistence');
 await ensureResultDetailTables(db);
 const sourceSha256=await sha256(sourceHtml),stamp=fetchedAt||new Date().toISOString();
 const snapshot={schemaVersion:'3.9.0',raceKey,sourceUrl,sourceSha256,identity:parsed.identity,rows:parsed.rows};
 const resultJson=JSON.stringify(snapshot),revisionId=`${raceKey}|${sourceSha256}`;
 const statements=[];
 statements.push(db.prepare(`INSERT OR IGNORE INTO lab_result_ingest_revisions(revision_id,race_key,source_url,source_sha256,runner_count,parsed_count,result_json,fetched_at) VALUES(?,?,?,?,?,?,?,?)`).bind(revisionId,raceKey,sourceUrl,sourceSha256,runners.length,parsed.rows.length,resultJson,stamp));
 for(const x of parsed.rows){
  statements.push(db.prepare(`INSERT INTO lab_race_outcomes(race_key,horse_no,horse_name,finish_position,source_kind,source_url,fetched_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET horse_name=excluded.horse_name,finish_position=excluded.finish_position,source_kind=excluded.source_kind,source_url=excluded.source_url,fetched_at=excluded.fetched_at`).bind(raceKey,x.horseNo,x.horseName,x.finishPosition,'jra-official-result-page-verified',sourceUrl,stamp));
  statements.push(db.prepare(`INSERT INTO lab_race_result_details(race_key,horse_no,horse_name,finish_position,finish_status,time_text,time_seconds,margin,corner_positions,last3f,popularity,odds,body_weight,body_weight_change,jockey,assigned_weight,source_url,source_sha256,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET horse_name=excluded.horse_name,finish_position=excluded.finish_position,finish_status=excluded.finish_status,time_text=excluded.time_text,time_seconds=excluded.time_seconds,margin=excluded.margin,corner_positions=excluded.corner_positions,last3f=excluded.last3f,popularity=excluded.popularity,odds=excluded.odds,body_weight=excluded.body_weight,body_weight_change=excluded.body_weight_change,jockey=excluded.jockey,assigned_weight=excluded.assigned_weight,source_url=excluded.source_url,source_sha256=excluded.source_sha256,fetched_at=excluded.fetched_at`).bind(raceKey,x.horseNo,x.horseName,x.finishPosition,x.finishStatus,x.timeText,x.timeSeconds,x.margin,x.cornerPositions,x.last3f,x.popularity,x.odds,x.bodyWeight,x.bodyWeightChange,x.jockey,x.assignedWeight,sourceUrl,sourceSha256,stamp));
 }
 await db.batch(statements);
 return{revisionId,sourceSha256,storedRows:parsed.rows.length,snapshot};
}
