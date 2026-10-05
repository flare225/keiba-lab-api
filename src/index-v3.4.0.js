import app from "./index-v3.3.1.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function clean(s){return String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim()}
function programUrl(date){const[y,m,d]=date.split("-");return `https://www.jra.go.jp/keiba/calendar${y}/${y}/${Number(m)}/${m}${d}.html`}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"keiba-lab/3.4.0 (+all-race program staging)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});const b=await r.arrayBuffer();let body;try{body=new TextDecoder("utf-8").decode(b)}catch{body=new TextDecoder("shift_jis").decode(b)}return{ok:r.ok,status:r.status,url:r.url,body}}

async function ensureProgramTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS jra_race_program (
    program_key TEXT PRIMARY KEY,
    race_date TEXT NOT NULL,
    venue TEXT NOT NULL,
    meeting_no INTEGER,
    day_no INTEGER,
    race_no INTEGER NOT NULL,
    race_label TEXT,
    surface TEXT,
    distance INTEGER,
    start_time TEXT,
    grade TEXT,
    source_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`).run();
}

function parsePrograms(html,date,sourceUrl){
  const text=clean(html);
  const venueRe=/(\d+)回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)(\d+)日/g;
  const headers=[];let m;
  while((m=venueRe.exec(text)))headers.push({index:m.index,meetingNo:Number(m[1]),venue:m[2],dayNo:Number(m[3])});
  const races=[];
  for(let i=0;i<headers.length;i++){
    const h=headers[i],end=i+1<headers.length?headers[i+1].index:text.length,section=text.slice(h.index,end);
    const raceRe=/([1-9]|1[0-2])レース\s+(.+?)\s+(\d{1,2})時(\d{2})分/g;let r;
    while((r=raceRe.exec(section))){
      const raceNo=Number(r[1]),label=r[2].trim();
      const course=label.match(/([123]\d{3})\s*[（(](芝(?:・外)?|ダ|障害)[）)]/);
      const distance=course?Number(course[1]):null;
      const rawSurface=course?course[2]:null;
      const surface=rawSurface?.startsWith("芝")?"芝":rawSurface==="ダ"?"ダート":rawSurface||null;
      const grade=(label.match(/（(GⅠ|GⅡ|GⅢ|L)）/)||[])[1]||null;
      races.push({programKey:`${date}:${h.venue}:${raceNo}`,date,venue:h.venue,meetingNo:h.meetingNo,dayNo:h.dayNo,raceNo,raceLabel:label,surface,distance,startTime:`${r[3].padStart(2,"0")}:${r[4]}`,grade,sourceUrl});
    }
  }
  return races;
}

async function persistPrograms(db,races){
  const now=new Date().toISOString();
  for(const r of races){
    await db.prepare(`INSERT INTO jra_race_program (program_key,race_date,venue,meeting_no,day_no,race_no,race_label,surface,distance,start_time,grade,source_url,fetched_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_key) DO UPDATE SET meeting_no=excluded.meeting_no,day_no=excluded.day_no,race_label=excluded.race_label,surface=excluded.surface,distance=excluded.distance,start_time=excluded.start_time,grade=excluded.grade,source_url=excluded.source_url,fetched_at=excluded.fetched_at`)
      .bind(r.programKey,r.date,r.venue,r.meetingNo,r.dayNo,r.raceNo,r.raceLabel,r.surface,r.distance,r.startTime,r.grade,r.sourceUrl,now).run();
  }
  return now;
}

async function stageProgram(env,date){
  if(!validDate(date))throw new Error("date must be YYYY-MM-DD");
  await ensureProgramTable(env.DB);
  const url=programUrl(date),page=await fetchText(url);
  if(!page.ok)return{ok:false,stage:"all-race-program-staging",version:"3.4.0",date,httpStatus:page.status,sourceUrl:url,error:"JRA program page not available"};
  const races=parsePrograms(page.body,date,page.url);
  if(!races.length)return{ok:false,stage:"all-race-program-staging",version:"3.4.0",date,httpStatus:page.status,sourceUrl:page.url,error:"No race rows parsed"};
  const fetchedAt=await persistPrograms(env.DB,races);
  const byVenue={};for(const r of races){byVenue[r.venue]=(byVenue[r.venue]||0)+1}
  return{ok:true,stage:"all-race-program-staging",version:"3.4.0",date,raceCount:races.length,gradedCount:races.filter(r=>r.grade).length,nonGradedCount:races.filter(r=>!r.grade).length,venueSummary:Object.entries(byVenue).map(([venue,raceCount])=>({venue,raceCount})),races,fetchedAt,storagePolicy:{baseDataset:"ALL official JRA races, not graded races only",heavyFeatureAnalysis:"graded races and user-selected targets are prioritized for expensive feature snapshots/locks",reason:"maiden/class races are valuable training examples for pace, course, ground, jockey/trainer and form features"}};
}

async function storageStatus(env,date){
  await ensureProgramTable(env.DB);
  const p=await env.DB.prepare(`SELECT COUNT(*) AS n,SUM(CASE WHEN grade IS NOT NULL THEN 1 ELSE 0 END) AS graded FROM jra_race_program WHERE race_date=?`).bind(date).first();
  const c=await env.DB.prepare(`SELECT COUNT(*) AS n FROM jra_races WHERE race_date=?`).bind(date).first();
  const rr=await env.DB.prepare(`SELECT COUNT(*) AS n FROM jra_runners WHERE race_key IN (SELECT race_key FROM jra_races WHERE race_date=?)`).bind(date).first();
  return{ok:true,stage:"all-race-storage-status",version:"3.4.0",date,programRaces:Number(p?.n||0),programGradedRaces:Number(p?.graded||0),raceCardsStored:Number(c?.n||0),runnersStored:Number(rr?.n||0),policy:{storeAllRaces:true,gradedOnly:false,fullCardTarget:"every official JRA race on each ingested meeting day",analysisPriority:"graded/selected target races first; raw/base data remains all-race"}};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"3.4.0",phase:"all-race accumulation foundation"});
    if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
    try{
      if(u.pathname==="/v1/lab/program-stage")return json(await stageProgram(env,u.searchParams.get("date")||"2026-10-10"));
      if(u.pathname==="/v1/lab/storage-status")return json(await storageStatus(env,u.searchParams.get("date")||"2026-10-10"));
      if(u.pathname==="/v1/lab/storage-policy")return json({ok:true,version:"3.4.0",policy:{baseDataset:"all official JRA races",gradedOnly:false,history:"horse history rows remain capped per target horse for feature generation, but source race-card accumulation is all-race",heavyAnalysis:"prioritize graded races and explicitly selected races to control Worker/D1 cost",prospectiveLocks:"only selected validation targets are sealed; this does not limit raw data accumulation"}});
      if(u.pathname==="/v1/lab/deploy-check")return json({ok:true,version:"3.4.0",build:"all-race-program-staging",now:new Date().toISOString()});
      return app.fetch(request,env,ctx);
    }catch(error){return json({ok:false,version:"3.4.0",error:String(error)},500)}
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
