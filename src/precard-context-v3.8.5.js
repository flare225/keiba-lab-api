import {sha256} from './card-evidence.js';

export const PRECARD_VERSION='3.8.5';
export const DEFAULT_PRECARD_TARGETS=[{
  raceKey:'2026-10-10:東京:11',raceDate:'2026-10-10',venue:'東京',raceNo:11,
  raceName:'サウジアラビアロイヤルカップ',sourceUrl:'https://www.jra.go.jp/keiba/race/092/horse.html',notBefore:'2026-10-06'
}];

const plain=s=>String(s||'')
  .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/\s+/g,' ').trim();
const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const iso=now=>new Date(now??Date.now()).toISOString();
export function todayJst(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function japaneseDate(date){const[y,m,d]=date.split('-').map(Number);return new RegExp(`${y}年\\s*0?${m}月\\s*0?${d}日`);}
function horseName(value){const v=plain(value).replace(/^\d+\s*/,'').trim();return /^[ァ-ヶー・ヴヷヸヹヺ]{2,24}$/.test(v)?v:null;}
function pedigreeValue(text,label,next){const re=new RegExp(`${label}\\s*[:：]\\s*(.*?)(?=\\s+(?:${next})\\s*[:：]|\\s+ここに注目|$)`);return text.match(re)?.[1]?.trim()||null;}

export function parsePrecardHorsePage(html,{expectedRaceName,expectedDate}={}){
  const pageText=plain(html);
  if(expectedRaceName&&!pageText.includes(expectedRaceName))throw new Error('precard source race-name mismatch');
  if(expectedDate&&!japaneseDate(expectedDate).test(pageText))throw new Error('precard source race-date mismatch');
  const placeholder=/出走馬情報は[\s\S]{0,120}公開予定/.test(pageText);
  const headings=[...String(html||'').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const horses=[],seen=new Set();
  for(let i=0;i<headings.length;i++){
    const name=horseName(headings[i][1]);if(!name||seen.has(name))continue;
    const start=(headings[i].index||0)+headings[i][0].length;
    const end=i+1<headings.length?(headings[i+1].index||String(html).length):String(html).length;
    const blockText=plain(String(html).slice(start,end));
    const sexAge=blockText.match(/(牡|牝|せん)\s*([2-9])歳?/);
    if(!sexAge)continue;
    const trainerMatch=blockText.match(/調教師\s*[:：]\s*([^（(]{1,40}?)\s*[（(]([^）)]+)[）)]/);
    const sire=pedigreeValue(blockText,'父','母');
    const dam=pedigreeValue(blockText,'母','母の父');
    const damsire=pedigreeValue(blockText,'母の父','ここに注目');
    const focus=(blockText.split(/ここに注目！?/)[1]||'').trim().slice(0,2000)||null;
    horses.push({name,sex:sexAge[1],age:Number(sexAge[2]),trainer:trainerMatch?.[1]?.trim()||null,stable:trainerMatch?.[2]?.trim()||null,sire,dam,damsire,focus});
    seen.add(name);
  }
  const warnings=[];
  if(!placeholder&&!horses.length)warnings.push('published-looking-page-but-no-runner-blocks-parsed');
  if(horses.some(x=>x.age!==2))warnings.push('non-two-year-old-runner-detected');
  if(horses.some(x=>!x.trainer))warnings.push('some-trainer-fields-missing');
  if(horses.some(x=>!x.sire||!x.dam||!x.damsire))warnings.push('some-pedigree-fields-missing');
  return{published:!placeholder&&horses.length>0,placeholder,horses,warnings,pageTextSample:pageText.slice(0,400)};
}

export async function ensurePrecardTables(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_precard_targets (
    race_key TEXT PRIMARY KEY,race_date TEXT NOT NULL,venue TEXT NOT NULL,race_no INTEGER NOT NULL,race_name TEXT NOT NULL,
    source_url TEXT NOT NULL,not_before TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    last_checked_at TEXT,last_success_at TEXT,last_source_sha256 TEXT,last_status TEXT,last_error TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_precard_runner_context (
    race_key TEXT NOT NULL,horse_name TEXT NOT NULL,sex TEXT,age INTEGER,trainer TEXT,stable TEXT,sire TEXT,dam TEXT,damsire TEXT,
    focus_text TEXT,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,extracted_at TEXT NOT NULL,active_in_latest INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(race_key,horse_name)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_precard_source_evidence (
    race_key TEXT PRIMARY KEY,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,parsed_count INTEGER NOT NULL,
    published_flag INTEGER NOT NULL,placeholder_flag INTEGER NOT NULL,fetched_at TEXT NOT NULL,parse_version TEXT NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS lab_precard_context_active ON lab_precard_runner_context(race_key,active_in_latest)').run();
}

export async function seedDefaultPrecardTargets(db,now=new Date()){
  await ensurePrecardTables(db);const stamp=iso(now);
  for(const t of DEFAULT_PRECARD_TARGETS){
    await db.prepare(`INSERT INTO lab_precard_targets
      (race_key,race_date,venue,race_no,race_name,source_url,not_before,enabled,created_at,updated_at,last_status)
      VALUES(?,?,?,?,?,?,?,1,?,?,'staged') ON CONFLICT(race_key) DO NOTHING`)
      .bind(t.raceKey,t.raceDate,t.venue,t.raceNo,t.raceName,t.sourceUrl,t.notBefore,stamp,stamp).run();
  }
}

function allowedSource(url){try{const u=new URL(url);return u.origin==='https://www.jra.go.jp'&&/\/horse\.html$/.test(u.pathname);}catch{return false}}
export async function fetchJraPrecardPage(url){
  if(!allowedSource(url))throw new Error('precard source must be an official JRA horse.html page');
  const response=await fetch(url,{headers:{'user-agent':'keiba-lab/3.8.5 (+precard-context; non-authoritative)','accept':'text/html,*/*;q=0.8'},redirect:'follow',signal:AbortSignal.timeout(20000)});
  const buffer=await response.arrayBuffer(),type=(response.headers.get('content-type')||'').toLowerCase();
  let charset=type.match(/charset\s*=\s*([^;\s]+)/)?.[1]?.replace(/["']/g,'')||'utf-8';
  if(/shift[_-]?jis|sjis|windows-31j/.test(charset))charset='shift_jis';else charset='utf-8';
  let body=new TextDecoder(charset).decode(buffer);
  if(charset==='utf-8'&&(body.match(/�/g)||[]).length>4)body=new TextDecoder('shift_jis').decode(buffer);
  const resolved=new URL(response.url||url);
  if(resolved.origin!=='https://www.jra.go.jp')throw new Error('precard source redirected off JRA');
  return{ok:response.ok,status:response.status,url:resolved.href,body};
}

export function shouldRefreshPrecard(target,now=new Date()){
  const date=todayJst(now);if(!target||Number(target.enabled)===0||date<target.not_before||date>target.race_date)return false;
  if(!target.last_success_at)return true;
  const last=Date.parse(target.last_success_at);return !Number.isFinite(last)||new Date(now).getTime()-last>=6*3600000;
}

async function updateTargetStatus(db,target,{status,error=null,checkedAt=iso(),successAt=null,sourceSha=null}={}){
  await db.prepare(`UPDATE lab_precard_targets SET last_checked_at=?,last_status=?,last_error=?,last_success_at=COALESCE(?,last_success_at),last_source_sha256=COALESCE(?,last_source_sha256),updated_at=? WHERE race_key=?`)
    .bind(checkedAt,status,error,successAt,sourceSha,checkedAt,target.race_key).run();
}

export async function ingestPrecardTarget(db,target,{fetchPage=fetchJraPrecardPage,now=new Date()}={}){
  await ensurePrecardTables(db);const checkedAt=iso(now);
  if(todayJst(now)<target.not_before)return{ok:true,status:'not-before-publication-window',raceKey:target.race_key,published:false,saved:0};
  let page;try{page=await fetchPage(target.source_url);}catch(error){await updateTargetStatus(db,target,{status:'source-error',error:String(error),checkedAt});return{ok:false,status:'source-error',raceKey:target.race_key,error:String(error)}}
  if(!page.ok){const error=`JRA source HTTP ${page.status}`;await updateTargetStatus(db,target,{status:'source-error',error,checkedAt});return{ok:false,status:'source-error',raceKey:target.race_key,error}}
  let parsed;try{parsed=parsePrecardHorsePage(page.body,{expectedRaceName:target.race_name,expectedDate:target.race_date});}catch(error){await updateTargetStatus(db,target,{status:'identity-error',error:String(error),checkedAt});return{ok:false,status:'identity-error',raceKey:target.race_key,error:String(error)}}
  const sourceSha=await sha256(page.body);
  await db.prepare(`INSERT INTO lab_precard_source_evidence(race_key,source_url,source_sha256,parsed_count,published_flag,placeholder_flag,fetched_at,parse_version)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET source_url=excluded.source_url,source_sha256=excluded.source_sha256,parsed_count=excluded.parsed_count,published_flag=excluded.published_flag,placeholder_flag=excluded.placeholder_flag,fetched_at=excluded.fetched_at,parse_version=excluded.parse_version`)
    .bind(target.race_key,page.url,sourceSha,parsed.horses.length,parsed.published?1:0,parsed.placeholder?1:0,checkedAt,PRECARD_VERSION).run();
  if(parsed.placeholder){await updateTargetStatus(db,target,{status:'not-published',checkedAt,sourceSha});return{ok:true,status:'not-published',raceKey:target.race_key,published:false,saved:0,warnings:parsed.warnings,sourceSha256:sourceSha}}
  if(!parsed.published){await updateTargetStatus(db,target,{status:'parse-empty',error:'No runner blocks parsed from non-placeholder page',checkedAt,sourceSha});return{ok:false,status:'parse-empty',raceKey:target.race_key,published:false,saved:0,warnings:parsed.warnings,sourceSha256:sourceSha}}
  if(target.last_source_sha256===sourceSha&&target.last_status==='published'){
    await updateTargetStatus(db,target,{status:'published',checkedAt,successAt:checkedAt,sourceSha});
    return{ok:true,status:'unchanged',raceKey:target.race_key,published:true,saved:0,parsedCount:parsed.horses.length,warnings:parsed.warnings,sourceSha256:sourceSha};
  }
  for(const h of parsed.horses){
    await db.prepare(`INSERT INTO lab_precard_runner_context
      (race_key,horse_name,sex,age,trainer,stable,sire,dam,damsire,focus_text,source_url,source_sha256,extracted_at,active_in_latest)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(race_key,horse_name) DO UPDATE SET sex=excluded.sex,age=excluded.age,trainer=excluded.trainer,stable=excluded.stable,sire=excluded.sire,dam=excluded.dam,damsire=excluded.damsire,focus_text=excluded.focus_text,source_url=excluded.source_url,source_sha256=excluded.source_sha256,extracted_at=excluded.extracted_at,active_in_latest=1`)
      .bind(target.race_key,h.name,h.sex,h.age,h.trainer,h.stable,h.sire,h.dam,h.damsire,h.focus,page.url,sourceSha,checkedAt).run();
  }
  const names=parsed.horses.map(x=>x.name),marks=names.map(()=>'?').join(',');
  await db.prepare(`UPDATE lab_precard_runner_context SET active_in_latest=0 WHERE race_key=? AND horse_name NOT IN (${marks})`).bind(target.race_key,...names).run();
  await updateTargetStatus(db,target,{status:'published',checkedAt,successAt:checkedAt,sourceSha});
  return{ok:true,status:'published',raceKey:target.race_key,published:true,saved:parsed.horses.length,parsedCount:parsed.horses.length,warnings:parsed.warnings,sourceSha256:sourceSha,authoritativeForCard:false,eligibleForSeal:false};
}

export async function precardAudit(db,raceKey){
  await ensurePrecardTables(db);
  const target=await db.prepare('SELECT * FROM lab_precard_targets WHERE race_key=?').bind(raceKey).first();
  if(!target)return{ok:false,version:PRECARD_VERSION,error:'precard target not found'};
  const rows=(await db.prepare('SELECT * FROM lab_precard_runner_context WHERE race_key=? AND active_in_latest=1 ORDER BY horse_name').bind(raceKey).all()).results||[];
  const evidence=await db.prepare('SELECT * FROM lab_precard_source_evidence WHERE race_key=?').bind(raceKey).first();
  const history=(await db.prepare(`SELECT c.horse_name,COUNT(p.race_date) AS history_rows FROM lab_precard_runner_context c
    JOIN lab_precard_targets t ON t.race_key=c.race_key LEFT JOIN jra_past_performances p ON p.horse_name=c.horse_name AND p.race_date<t.race_date
    WHERE c.race_key=? AND c.active_in_latest=1 GROUP BY c.horse_name ORDER BY c.horse_name`).bind(raceKey).all()).results||[];
  const histBy=new Map(history.map(x=>[x.horse_name,Number(x.history_rows||0)]));
  const enriched=rows.map(x=>({...x,historyRows:histBy.get(x.horse_name)||0}));
  const race=await db.prepare('SELECT race_key,runner_count,fetched_at FROM jra_races WHERE race_key=?').bind(raceKey).first();
  const official=race?((await db.prepare('SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(raceKey).all()).results||[]):[];
  const preSet=new Set(rows.map(x=>x.horse_name)),officialSet=new Set(official.map(x=>x.horse_name));
  const matched=official.filter(x=>preSet.has(x.horse_name)).map(x=>x.horse_name);
  const featuredNotOnCard=rows.filter(x=>!officialSet.has(x.horse_name)).map(x=>x.horse_name);
  const cardNotFeatured=official.filter(x=>!preSet.has(x.horse_name)).map(x=>x.horse_name);
  const count=rows.length,pedigreeReady=rows.filter(x=>x.sire&&x.dam&&x.damsire).length,trainerReady=rows.filter(x=>x.trainer).length,age2=rows.filter(x=>Number(x.age)===2).length;
  const warnings=[];
  if(evidence?.published_flag&&!rows.length)warnings.push('published-source-with-zero-active-context-rows');
  if(rows.some(x=>Number(x.age)!==2))warnings.push('non-two-year-old-context-row');
  if(count&&pedigreeReady<count)warnings.push('precard-pedigree-incomplete');
  if(count&&trainerReady<count)warnings.push('precard-trainer-incomplete');
  if(enriched.some(x=>x.historyRows===0))warnings.push('zero-history-two-year-old-present');
  if(enriched.some(x=>x.historyRows===1))warnings.push('one-history-two-year-old-present');
  return{ok:true,version:PRECARD_VERSION,stage:'precard-context-audit',raceKey,target:{date:target.race_date,venue:target.venue,raceNo:Number(target.race_no),raceName:target.race_name,sourceUrl:target.source_url,status:target.last_status,lastCheckedAt:target.last_checked_at,lastSuccessAt:target.last_success_at},sourceEvidence:evidence||null,dataQuality:{featuredRunnerCount:count,age2Count:age2,pedigreeCompleteCount:pedigreeReady,pedigreeCoveragePct:count?Math.round(pedigreeReady/count*1000)/10:0,trainerCompleteCount:trainerReady,trainerCoveragePct:count?Math.round(trainerReady/count*1000)/10:0,zeroHistoryCount:enriched.filter(x=>x.historyRows===0).length,oneHistoryCount:enriched.filter(x=>x.historyRows===1).length,twoPlusHistoryCount:enriched.filter(x=>x.historyRows>=2).length},officialCardComparison:race?{status:'available',officialRunnerCount:Number(race.runner_count||official.length),storedOfficialRows:official.length,matchedCount:matched.length,matched,featuredNotOnCard,cardNotFeatured}:{status:'official-card-not-yet-stored',matchedCount:0,matched:[],featuredNotOnCard:[],cardNotFeatured:[]},warnings,runners:enriched,guardrails:{writesJraRunners:false,writesJraRaces:false,authoritativeForCard:false,eligibleForProspectiveSeal:false,officialNumberedCardStillRequired:true,horseNumbersNeverInferredFromPrecardPage:true}};
}

export async function runPrecardSweep(event,env,ctx,{fetchPage=fetchJraPrecardPage,now}={}){
  const instant=now?new Date(now):new Date(event?.scheduledTime??Date.now());
  await seedDefaultPrecardTargets(env.DB,instant);
  const date=todayJst(instant);
  const targets=(await env.DB.prepare('SELECT * FROM lab_precard_targets WHERE enabled=1 AND not_before<=? AND race_date>=? ORDER BY race_date,venue,race_no LIMIT 3').bind(date,date).all()).results||[];
  const runs=[];
  for(const target of targets){
    if(!shouldRefreshPrecard(target,instant)){runs.push({raceKey:target.race_key,ok:true,status:'fresh-skip'});continue;}
    runs.push(await ingestPrecardTarget(env.DB,target,{fetchPage,now:instant}));
  }
  return{ok:runs.every(x=>x.ok),version:PRECARD_VERSION,stage:'scheduled-precard-context-sweep',date,targetCount:targets.length,runs,note:'Pre-card context is non-authoritative and never substitutes for the numbered official race card.'};
}
