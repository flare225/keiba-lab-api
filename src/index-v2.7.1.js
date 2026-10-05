import app from "./index-v2.7.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function text(value){return String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim()}
function rowCells(rowHtml){return [...String(rowHtml||"").matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>text(m[1]))}
function parseJapaneseDate(value){const m=String(value||"").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`:null}
function parseFinishPosition(value){const s=String(value??"").trim();if(!s)return null;if(/中止|取消|除外|失格/.test(s))return null;const m=s.match(/(^|\D)(\d{1,2})(?:\s*着)?(?:\D|$)/);return m?Number(m[2]):null}

async function fetchHtml(url){
  const response=await fetch(url,{headers:{"user-agent":"keiba-lab/2.7.1 (+official outcome parser fix)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});
  const buffer=await response.arrayBuffer();
  let body;try{body=new TextDecoder("shift_jis").decode(buffer)}catch{body=new TextDecoder("utf-8").decode(buffer)}
  return{ok:response.ok,status:response.status,url:response.url,body};
}

function extractProfileLinks(html,runnerNames,baseUrl){
  const wanted=new Set(runnerNames),found=new Map();
  const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){
    const anchorText=text(m[2]);if(!wanted.has(anchorText)||found.has(anchorText))continue;
    try{const u=new URL(m[1].replace(/&amp;/g,"&"),baseUrl);const cname=u.searchParams.get("CNAME")||"";if(!/\/JRADB\/accessU\.html/i.test(u.pathname))continue;if(!/^pw01dud\d{2}/i.test(cname))continue;found.set(anchorText,u.href)}catch{}
  }
  return found;
}

function findTargetResult(profileHtml,raceDate,raceName){
  let loose=null;
  for(const match of String(profileHtml||"").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=rowCells(match[1]);if(cells.length<9)continue;
    const d=parseJapaneseDate(cells[0]);const rowText=text(match[1]);
    if(d!==raceDate)continue;
    const finishCell=String(cells[8]??"").trim();
    let finish=parseFinishPosition(finishCell);
    let finishSource="cell:8";
    if(!Number.isInteger(finish)){
      for(let i=0;i<cells.length;i++){
        const c=String(cells[i]??"").trim();
        if(!/着/.test(c))continue;
        const p=parseFinishPosition(c);
        if(Number.isInteger(p)){finish=p;finishSource=`cell:${i}`;break}
      }
    }
    const item={finishPosition:finish,finishCellText:finishCell,finishSource,cells:cells.slice(0,16),rowText};
    if(raceName&&rowText.includes(raceName))return item;
    if(!loose)loose=item;
  }
  return loose;
}

async function mapLimit(items,limit,worker){const output=new Array(items.length);let next=0;async function run(){while(true){const i=next++;if(i>=items.length)return;output[i]=await worker(items[i],i)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return output}

async function ensureOutcomeTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_race_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    finish_position INTEGER,
    source_kind TEXT NOT NULL,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no)
  )`).run();
}

async function loadRace(env,date,venue,raceNo){
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,source_url FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  return{race,runners:rr.results||[]};
}

async function stage2OutcomeFixed(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureOutcomeTable(env.DB);
  const {race,runners}=await loadRace(env,date,venue,raceNo);
  if(!race.source_url)throw new Error("race source_url is missing");
  const racePage=await fetchHtml(race.source_url);if(!racePage.ok)throw new Error(`race page HTTP ${racePage.status}`);
  const links=extractProfileLinks(racePage.body,runners.map(r=>r.horse_name),racePage.url);
  const fetched=await mapLimit(runners,4,async r=>{
    const profileUrl=links.get(r.horse_name)||null;
    if(!profileUrl)return{...r,status:"profile-link-not-found",finishPosition:null,profileUrl:null};
    try{
      const p=await fetchHtml(profileUrl);
      if(!p.ok)return{...r,status:`profile-http-${p.status}`,finishPosition:null,profileUrl};
      const found=findTargetResult(p.body,race.race_date,race.race_name);
      return{...r,status:Number.isInteger(found?.finishPosition)?"found":found?"row-found-no-finish":"target-row-not-found",finishPosition:found?.finishPosition??null,finishCellText:found?.finishCellText??null,finishSource:found?.finishSource??null,debugCells:found?.cells??null,profileUrl};
    }catch(e){return{...r,status:"error",error:String(e),finishPosition:null,profileUrl}}
  });
  const now=new Date().toISOString();let saved=0;
  for(const x of fetched){
    if(!Number.isInteger(x.finishPosition))continue;
    await env.DB.prepare(`INSERT INTO lab_race_outcomes (race_key,horse_no,horse_name,finish_position,source_kind,source_url,fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET horse_name=excluded.horse_name,finish_position=excluded.finish_position,source_kind=excluded.source_kind,source_url=excluded.source_url,fetched_at=excluded.fetched_at`).bind(race.race_key,x.horse_no,x.horse_name,x.finishPosition,"jra-horse-profile-target-row-v2.7.1",x.profileUrl,now).run();
    saved++;
  }
  const complete=saved===runners.length;
  return{ok:saved>0,stage:"full-boost-2-official-outcome-ingest",version:"2.7.1",step:2,raceKey:race.race_key,parserFix:"accepts JRA finish cells such as '1着' / spaced labels and reports the actual finish cell when unresolved",profileLinksFound:links.size,savedOutcomes:saved,runnerCount:runners.length,coveragePct:runners.length?round1(saved/runners.length*100):0,complete,results:fetched.map(x=>({horseNo:x.horse_no,horseName:x.horse_name,status:x.status,finishPosition:x.finishPosition,finishCellText:x.finishCellText,finishSource:x.finishSource,debugCells:x.status==="row-found-no-finish"?x.debugCells:undefined})),nextStep:complete?3:"rerun step 2 after inspecting unresolved rows"};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.7.1",phase:"official outcome parser fix"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(u.pathname==="/v1/lab/result-ingest")return json(await stage2OutcomeFixed(request,env));
      if(u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===2)return json(await stage2OutcomeFixed(request,env));
      return app.fetch(request,env,ctx);
    }catch(e){return json({ok:false,version:"2.7.1",error:String(e)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
