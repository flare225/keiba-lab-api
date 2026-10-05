import app from "./index-v2.7.1.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function round1(v){return Math.round(Number(v||0)*10)/10}
function text(value){return String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim()}
function rowCells(rowHtml){return [...String(rowHtml||"").matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>text(m[1]))}
function parseJapaneseDate(value){const m=String(value||"").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`:null}

async function fetchHtml(url){
  const response=await fetch(url,{headers:{"user-agent":"keiba-lab/2.7.2 (+official JRA result-page ingest)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});
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

function findTargetRowHtml(profileHtml,raceDate,raceName){
  let loose=null;
  for(const m of String(profileHtml||"").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=rowCells(m[1]);if(cells.length<3)continue;
    const d=parseJapaneseDate(cells[0]);const rowText=text(m[1]);
    if(d!==raceDate)continue;
    const item={rowHtml:m[1],rowText,cells};
    if(raceName&&rowText.includes(raceName))return item;
    if(!loose)loose=item;
  }
  return loose;
}

function extractLinks(html,baseUrl){
  const out=[];const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){
    try{const u=new URL(m[1].replace(/&amp;/g,"&"),baseUrl);out.push({href:u.href,pathname:u.pathname,cname:u.searchParams.get("CNAME")||"",anchorText:text(m[2])})}catch{}
  }
  return out;
}

function scoreResultLink(link){
  let s=0;if(/\/JRADB\/accessS\.html/i.test(link.pathname||""))s+=20;if(/^pw01sde/i.test(link.cname||""))s+=30;if(/結果|成績|レース結果/.test(link.anchorText||""))s+=5;return s;
}

function parseFinishCell(value,fieldSize){
  const s=String(value||"").replace(/\s+/g,"");
  let m=s.match(/^(\d{1,2})着$/);if(m){const n=Number(m[1]);return n>=1&&n<=fieldSize?n:null}
  m=s.match(/^(\d{1,2})$/);if(m){const n=Number(m[1]);return n>=1&&n<=fieldSize?n:null}
  return null;
}

function parseOutcomeRows(resultHtml,runners){
  const out=[];
  for(const r of runners){
    let matched=null;
    for(const m of String(resultHtml||"").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const rowHtml=m[1],rowText=text(rowHtml);if(!rowText.includes(r.horse_name))continue;
      const cells=rowCells(rowHtml);if(cells.length<4)continue;
      let finish=null,source=null;
      for(let i=0;i<Math.min(4,cells.length);i++){
        const n=parseFinishCell(cells[i],runners.length);if(n!=null){finish=n;source=`cell:${i}`;break}
      }
      matched={horseNo:r.horse_no,horseName:r.horse_name,finishPosition:finish,finishSource:source,cells:cells.slice(0,16),rowText};
      if(finish!=null)break;
    }
    out.push(matched||{horseNo:r.horse_no,horseName:r.horse_name,finishPosition:null,finishSource:null,cells:[],rowText:null});
  }
  return out;
}

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

async function stage2OutcomeV272(request,env){
  const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue"),raceNo=Number(u.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo))throw new Error("date=YYYY-MM-DD, venue and race_no are required");
  await ensureOutcomeTable(env.DB);const {race,runners}=await loadRace(env,date,venue,raceNo);if(!race.source_url)throw new Error("race source_url is missing");

  const racePage=await fetchHtml(race.source_url);if(!racePage.ok)throw new Error(`race page HTTP ${racePage.status}`);
  const profileLinks=extractProfileLinks(racePage.body,runners.map(r=>r.horse_name),racePage.url);

  let resultUrl=null,resultResolvedFrom=null,targetRowDebug=null;
  for(const r of runners){
    const profileUrl=profileLinks.get(r.horse_name);if(!profileUrl)continue;
    const p=await fetchHtml(profileUrl);if(!p.ok)continue;
    const target=findTargetRowHtml(p.body,race.race_date,race.race_name);if(!target)continue;
    const links=extractLinks(target.rowHtml,p.url).map(x=>({...x,score:scoreResultLink(x)})).sort((a,b)=>b.score-a.score);
    const best=links.find(x=>x.score>0);
    if(best){resultUrl=best.href;resultResolvedFrom=r.horse_name;targetRowDebug={horseName:r.horse_name,rowCells:target.cells.slice(0,16),bestLink:{href:best.href,cname:best.cname,anchorText:best.anchorText,score:best.score}};break}
  }

  if(!resultUrl){
    return{ok:false,stage:"full-boost-2-official-outcome-ingest",version:"2.7.2",step:2,raceKey:race.race_key,profileLinksFound:profileLinks.size,savedOutcomes:0,runnerCount:runners.length,coveragePct:0,complete:false,error:"Could not resolve JRA result page from any target race row",next:"Inspect target-row links"};
  }

  const resultPage=await fetchHtml(resultUrl);if(!resultPage.ok)throw new Error(`result page HTTP ${resultPage.status}`);
  const parsed=parseOutcomeRows(resultPage.body,runners);
  const now=new Date().toISOString();let saved=0;
  for(const x of parsed){
    if(!Number.isInteger(x.finishPosition))continue;
    await env.DB.prepare(`INSERT INTO lab_race_outcomes (race_key,horse_no,horse_name,finish_position,source_kind,source_url,fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no) DO UPDATE SET horse_name=excluded.horse_name,finish_position=excluded.finish_position,source_kind=excluded.source_kind,source_url=excluded.source_url,fetched_at=excluded.fetched_at`).bind(race.race_key,x.horseNo,x.horseName,x.finishPosition,"jra-official-result-page",resultPage.url,now).run();saved++;
  }
  const complete=saved===runners.length;
  return{ok:saved>0,stage:"full-boost-2-official-outcome-ingest",version:"2.7.2",step:2,raceKey:race.race_key,parserFix:"Resolves the official JRA result page from the target profile row, then reads finish order from the race result table instead of guessing the profile-history cell layout.",profileLinksFound:profileLinks.size,resultPage:{url:resultPage.url,resolvedFromHorse:resultResolvedFrom,httpStatus:resultPage.status},targetRowDebug,savedOutcomes:saved,runnerCount:runners.length,coveragePct:runners.length?round1(saved/runners.length*100):0,complete,results:parsed.map(x=>({horseNo:x.horseNo,horseName:x.horseName,finishPosition:x.finishPosition,finishSource:x.finishSource,debugCells:x.finishPosition==null?x.cells:undefined})),nextStep:3};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.7.2",phase:"official result-page ingest fix"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if((u.pathname==="/v1/lab/full-boost"&&Number(u.searchParams.get("step")||1)===2)||u.pathname==="/v1/lab/result-ingest")return json(await stage2OutcomeV272(request,env));
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"2.7.2",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
