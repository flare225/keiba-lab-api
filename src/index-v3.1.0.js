import app from "./index-v3.0.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function text(value){return String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim()}
function rowCells(rowHtml){return [...String(rowHtml||"").matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>text(m[1]))}
function parseJapaneseDate(value){const m=String(value||"").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`:null}
function parseCourse(value){const m=String(value||"").replace(/\s+/g,"").match(/(芝|ダート|ダ|障害)([123][0-9]{3})/);return m?{surface:m[1]==="ダ"?"ダート":m[1],distance:Number(m[2])}:{surface:null,distance:null}}
function numberOrNull(v){const m=String(v??"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
function integerOrNull(v){const s=String(v??"").trim();return /^\d+$/.test(s)?Number(s):null}
function parseBodyWeight(value){const s=String(value||"");const w=s.match(/(\d{3})/);const c=s.match(/[（(]\s*([+-]?\d+)\s*[）)]/);return{bodyWeight:w?Number(w[1]):null,bodyWeightChange:c?Number(c[1]):null}}
function normalizeCondition(value){const s=String(value||"").replace(/\s+/g,"");if(/不良/.test(s))return"不良";if(/稍重/.test(s))return"稍重";if(/重/.test(s))return"重";if(/良/.test(s))return"良";return s||null}

async function fetchHtml(url){const r=await fetch(url,{headers:{"user-agent":"keiba-lab/3.1.0 (+history parser repair)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});const b=await r.arrayBuffer();let body;try{body=new TextDecoder("shift_jis").decode(b)}catch{body=new TextDecoder("utf-8").decode(b)}return{ok:r.ok,status:r.status,url:r.url,body}}
function extractProfileLinks(html,runnerNames,baseUrl){const wanted=new Set(runnerNames),found=new Map();const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){const a=text(m[2]);if(!wanted.has(a)||found.has(a))continue;try{const u=new URL(m[1].replace(/&amp;/g,"&"),baseUrl);const cname=u.searchParams.get("CNAME")||"";if(!/\/JRADB\/accessU\.html/i.test(u.pathname)||!/^pw01dud\d{2}/i.test(cname))continue;found.set(a,u.href)}catch{}}return found}
async function mapLimit(items,limit,worker){const out=new Array(items.length);let next=0;async function run(){while(true){const i=next++;if(i>=items.length)return;out[i]=await worker(items[i],i)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out}
async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}

function detectFinishAndLayout(cells){
  // JRA profile rows observed in 2026 place finish immediately before jockey.
  // Locate the jockey structurally: followed by assigned weight (~45-65kg) and then body weight (~300-600kg).
  for(let j=7;j<cells.length-2;j++){
    const weight=numberOrNull(cells[j+1]);
    const body=parseBodyWeight(cells[j+2]).bodyWeight;
    const finish=integerOrNull(cells[j-1]);
    if(weight!=null&&weight>=45&&weight<=65&&body!=null&&body>=300&&body<=650&&finish!=null&&finish>=1&&finish<=30){
      return{finishPosition:finish,jockeyIndex:j,finishIndex:j-1,weightIndex:j+1,bodyIndex:j+2,timeIndex:j+3,last3fIndex:j+5};
    }
  }
  // Fallback for the common current layout: date, venue, race, course, going, field, popularity, finish, jockey, weight, body, time...
  const fallback=integerOrNull(cells[7]);
  if(fallback!=null&&fallback>=1&&fallback<=30)return{finishPosition:fallback,jockeyIndex:8,finishIndex:7,weightIndex:9,bodyIndex:10,timeIndex:11,last3fIndex:13};
  return null;
}

function parsePastRows(html,horseName,profileUrl,beforeDate,limit){
  const rows=[];
  for(const m of String(html||"").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=rowCells(m[1]);if(cells.length<11)continue;
    const raceDate=parseJapaneseDate(cells[0]);const course=parseCourse(cells[3]);
    if(!raceDate||!course.distance||raceDate>=beforeDate)continue;
    const layout=detectFinishAndLayout(cells);if(!layout)continue;
    const fieldSize=integerOrNull(cells[5]);
    const popularity=layout.finishIndex-1>=6?integerOrNull(cells[layout.finishIndex-1]):null;
    const body=parseBodyWeight(cells[layout.bodyIndex]);
    rows.push({horseName,raceDate,venue:cells[1]||null,raceName:cells[2]||null,surface:course.surface,distance:course.distance,finishPosition:layout.finishPosition,fieldSize,popularity,jockey:cells[layout.jockeyIndex]||null,assignedWeight:numberOrNull(cells[layout.weightIndex]),bodyWeight:body.bodyWeight,bodyWeightChange:body.bodyWeightChange,timeText:cells[layout.timeIndex]||null,last3f:numberOrNull(cells[layout.last3fIndex]),cornerPositions:null,trackCondition:normalizeCondition(cells[4]),sourceUrl:profileUrl,debug:{finishIndex:layout.finishIndex,jockeyIndex:layout.jockeyIndex,cells:cells.slice(0,16)}});
  }
  rows.sort((a,b)=>b.raceDate.localeCompare(a.raceDate));const out=[],seen=new Set();for(const r of rows){const k=`${r.raceDate}|${r.venue}|${r.raceName}|${r.distance}`;if(seen.has(k))continue;seen.add(k);out.push(r)}return out.slice(0,limit);
}

async function ensureHistoryTable(db){await db.prepare(`CREATE TABLE IF NOT EXISTS jra_past_performances (id INTEGER PRIMARY KEY AUTOINCREMENT,horse_name TEXT NOT NULL,race_date TEXT NOT NULL,venue TEXT,race_name TEXT,surface TEXT,distance INTEGER,finish_position INTEGER,field_size INTEGER,popularity INTEGER,odds REAL,jockey TEXT,assigned_weight REAL,body_weight INTEGER,body_weight_change INTEGER,time_text TEXT,last3f REAL,corner_positions TEXT,track_condition TEXT,source_url TEXT,fetched_at TEXT NOT NULL,UNIQUE(horse_name,race_date,venue,race_name))`).run()}
async function loadRace(env,date,venue,raceNo){const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,source_url FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();if(!race)throw new Error("race not found in D1");const rr=await env.DB.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();return{race,runners:rr.results||[]}}
async function quality(db,runners,date){const names=runners.map(x=>x.horse_name);if(!names.length)return{};const marks=names.map(()=>"?").join(",");const q=await db.prepare(`SELECT COUNT(*) rows_total,SUM(CASE WHEN finish_position IS NOT NULL THEN 1 ELSE 0 END) finish_rows,SUM(CASE WHEN field_size IS NOT NULL THEN 1 ELSE 0 END) field_rows,SUM(CASE WHEN finish_position IS NOT NULL AND field_size IS NOT NULL THEN 1 ELSE 0 END) usable_rows,COUNT(DISTINCT CASE WHEN finish_position IS NOT NULL AND field_size IS NOT NULL THEN horse_name END) horses_usable FROM jra_past_performances WHERE horse_name IN (${marks}) AND race_date < ?`).bind(...names,date).first();return Object.fromEntries(Object.entries(q||{}).map(([k,v])=>[k,Number(v||0)]))}

async function historyRepair(request,env,ctx){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no")),track=u.searchParams.get("track")||"良";
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureHistoryTable(env.DB);const {race,runners}=await loadRace(env,date,venue,raceNo);if(!race.source_url)throw new Error("race source_url missing");
  const before=await quality(env.DB,runners,date);const card=await fetchHtml(race.source_url);if(!card.ok)throw new Error(`race page HTTP ${card.status}`);
  const links=extractProfileLinks(card.body,runners.map(x=>x.horse_name),card.url);
  const fetched=await mapLimit(runners,4,async r=>{const profileUrl=links.get(r.horse_name)||null;if(!profileUrl)return{horseNo:r.horse_no,horseName:r.horse_name,status:"profile-link-not-found",rows:[]};try{const p=await fetchHtml(profileUrl);if(!p.ok)return{horseNo:r.horse_no,horseName:r.horse_name,status:`http-${p.status}`,rows:[]};const rows=parsePastRows(p.body,r.horse_name,profileUrl,date,5);return{horseNo:r.horse_no,horseName:r.horse_name,status:rows.length?"parsed":"no-usable-history",rows}}catch(e){return{horseNo:r.horse_no,horseName:r.horse_name,status:"error",error:String(e),rows:[]}}});
  const now=new Date().toISOString();let savedRows=0;
  for(const item of fetched){for(const p of item.rows){await env.DB.prepare(`INSERT INTO jra_past_performances (horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,popularity,odds,jockey,assigned_weight,body_weight,body_weight_change,time_text,last3f,corner_positions,track_condition,source_url,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(horse_name,race_date,venue,race_name) DO UPDATE SET surface=excluded.surface,distance=excluded.distance,finish_position=excluded.finish_position,field_size=excluded.field_size,popularity=excluded.popularity,jockey=excluded.jockey,assigned_weight=excluded.assigned_weight,body_weight=excluded.body_weight,body_weight_change=excluded.body_weight_change,time_text=excluded.time_text,last3f=excluded.last3f,track_condition=excluded.track_condition,source_url=excluded.source_url,fetched_at=excluded.fetched_at`).bind(p.horseName,p.raceDate,p.venue,p.raceName,p.surface,p.distance,p.finishPosition,p.fieldSize,p.popularity,null,p.jockey,p.assignedWeight,p.bodyWeight,p.bodyWeightChange,p.timeText,p.last3f,p.cornerPositions,p.trackCondition,p.sourceUrl,now).run();savedRows++}}
  const afterHistory=await quality(env.DB,runners,date);
  const base=await invoke(u.origin,"/v1/lab/rank",{date,venue,race_no:raceNo,track,persist:1},env,ctx);if(base.status>=400||base.data?.ok===false)throw new Error(`base rebuild failed: ${base.data?.error||base.status}`);
  const integrated=await invoke(u.origin,"/v1/lab/integrated",{date,venue,race_no:raceNo,track,persist:1},env,ctx);if(integrated.status>=400||integrated.data?.ok===false)throw new Error(`integrated rebuild failed: ${integrated.data?.error||integrated.status}`);
  const repair=await invoke(u.origin,"/v1/lab/source-repair",{date,venue,race_no:raceNo,track},env,ctx);
  return{ok:true,stage:"full-boost-5-history-parser-repair",version:"3.1.0",step:5,race:{raceKey:race.race_key,raceName:race.race_name,runnerCount:runners.length,trackCondition:track},parserFix:"Finish is detected structurally as the pure-integer cell immediately before jockey; jockey is detected by assigned-weight and body-weight cells that follow it.",profileLinksFound:links.size,savedRows,beforeHistoryQuality:before,afterHistoryQuality:afterHistory,horseDiagnostics:fetched.map(x=>({horseNo:x.horseNo,horseName:x.horseName,status:x.status,rows:x.rows.length,sample:x.rows[0]?{raceDate:x.rows[0].raceDate,raceName:x.rows[0].raceName,finishPosition:x.rows[0].finishPosition,fieldSize:x.rows[0].fieldSize,jockey:x.rows[0].jockey,debug:x.rows[0].debug}:null})),baseRebuild:{ok:base.data?.ok,version:base.data?.version,persistedSnapshots:base.data?.persistedSnapshots},integratedRebuild:{ok:integrated.data?.ok,version:integrated.data?.version,persistedSnapshots:integrated.data?.persistedSnapshots??null},coverageAfter:repair.data?.after??null,guardrails:{targetRaceExcludedFromHistory:true,cutoff:`race_date < ${date}`,oldModelLockUntouched:true,resultUsedForFeatureRepair:false,weightMutation:false},next:"If core base coverage is restored, create a separate repaired reconstruction lock and compare it with the original lock. Do not award prospective validation credit."};
}

export default{async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.1.0",phase:"history parser repair + base feature rebuild"});if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===5)||u.pathname==="/v1/lab/history-repair")return json(await historyRepair(request,env,ctx));if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.1.0",build:"history-parser-repair",now:new Date().toISOString()});return app.fetch(request,env,ctx)}catch(error){return json({ok:false,version:"3.1.0",error:String(error)},500)}},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
