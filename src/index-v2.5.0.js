import app from "./index-v2.4.4.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}

function decodeEntities(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))}
function stripTags(s){return decodeEntities(String(s||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function attr(tag,name){const m=String(tag||"").match(new RegExp(`${name}="([^"]*)"`,`i`));return m?decodeEntities(m[1]):null}

async function fetchText(url,ua){
  try{
    const r=await fetch(url,{headers:{"user-agent":ua,accept:"text/xml,text/vtt,text/plain,*/*;q=0.8"},redirect:"follow"});
    const text=await r.text();
    return{ok:r.ok,status:r.status,url:r.url,text,length:text.length};
  }catch(e){return{ok:false,status:null,url,error:String(e),text:"",length:0}}
}

function parseTrackList(xml){
  const out=[];
  for(const m of String(xml||"").matchAll(/<track\b[^>]*\/?>/gi)){
    const tag=m[0];
    out.push({
      id:attr(tag,"id"),name:attr(tag,"name"),langCode:attr(tag,"lang_code"),langOriginal:attr(tag,"lang_original"),langTranslated:attr(tag,"lang_translated"),kind:attr(tag,"kind"),vssId:attr(tag,"vss_id")
    });
  }
  return out;
}

function transcriptText(raw){
  const s=String(raw||"");
  if(/^WEBVTT/m.test(s)){
    return s.split(/\r?\n/)
      .filter(line=>line.trim()&&!/^WEBVTT/.test(line)&&!/^NOTE\b/.test(line)&&!/^\d+$/.test(line)&&!(/-->/.test(line)))
      .join(" ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  }
  if(/<text\b/i.test(s)){
    const parts=[];
    for(const m of s.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi))parts.push(stripTags(m[1]));
    return parts.join(" ").replace(/\s+/g," ").trim();
  }
  return stripTags(s);
}

async function getTimedtextTrack(videoId,track){
  const q=new URLSearchParams({v:videoId,lang:track.langCode||"ja",fmt:"vtt"});
  if(track.name)q.set("name",track.name);
  if(track.kind)q.set("kind",track.kind);
  const url=`https://www.youtube.com/api/timedtext?${q.toString()}`;
  const r=await fetchText(url,"keiba-lab/2.5.0 (+direct timedtext fallback)");
  const text=transcriptText(r.text);
  return{...r,transcript:text,transcriptLength:text.length};
}

async function timedtextDiagnostics(request,env,ctx){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  const featureId=url.searchParams.get("feature_id")||null;

  const meta=await invoke(url.origin,"/v1/lab/workout-video-meta",{date,venue,race_no:raceNo,feature_id:featureId},env,ctx);
  if(meta.status>=400||meta.data?.ok===false)throw new Error(`video metadata failed: ${meta.data?.error||meta.status}`);
  const raceKey=meta.data?.race?.raceKey;
  const rr=await env.DB.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(raceKey).all();
  const runners=rr.results||[];
  const videos=[];

  for(const v of meta.data?.videos||[]){
    const listUrl=`https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(v.videoId)}`;
    const listed=await fetchText(listUrl,"keiba-lab/2.5.0 (+timedtext track list)");
    let tracks=parseTrackList(listed.text);
    const probed=[];

    // Some videos return an empty track list even when a direct Japanese ASR route exists.
    if(tracks.length===0){
      tracks=[
        {langCode:"ja",name:null,kind:null,probe:true},
        {langCode:"ja",name:null,kind:"asr",probe:true}
      ];
    }

    for(const t of tracks.slice(0,6)){
      const tr=await getTimedtextTrack(v.videoId,t);
      const matches=runners.filter(r=>tr.transcript.includes(r.horse_name)).map(r=>({horseNo:r.horse_no,horseName:r.horse_name}));
      probed.push({
        langCode:t.langCode||null,name:t.name||null,kind:t.kind||null,listed:!t.probe,
        fetchOk:tr.ok,httpStatus:tr.status,rawLength:tr.length,transcriptLength:tr.transcriptLength,
        transcriptSample:tr.transcript.slice(0,1600),runnerMatches:matches
      });
    }

    videos.push({
      videoId:v.videoId,title:v.title||null,
      trackListFetchOk:listed.ok,trackListHttpStatus:listed.status,trackListLength:listed.length,
      listedTrackCount:parseTrackList(listed.text).length,
      tracks:probed
    });
  }

  const matchedNos=new Set(videos.flatMap(v=>v.tracks.flatMap(t=>t.runnerMatches.map(x=>Number(x.horseNo)))));
  const matchedRunners=runners.filter(r=>matchedNos.has(Number(r.horse_no)));
  const anyTranscript=videos.some(v=>v.tracks.some(t=>t.transcriptLength>0));
  const any429=videos.some(v=>v.trackListHttpStatus===429||v.tracks.some(t=>t.httpStatus===429));

  return{
    ok:true,stage:"official-workout-direct-timedtext-diagnostics",version:"2.5.0",
    race:meta.data?.race||{date,venue,raceNo},videoCount:videos.length,videos,
    runnerTimedtextMatches:{matched:matchedRunners.length,runnerCount:runners.length,coveragePct:runners.length?Math.round(matchedRunners.length/runners.length*1000)/10:0,matchedRunners,unmatchedRunners:runners.filter(r=>!matchedNos.has(Number(r.horse_no)))},
    sourceUsability:matchedRunners.length>0?"horse-names-detected-in-direct-timedtext":anyTranscript?"transcript-found-but-no-exact-horse-name-match":any429?"youtube-rate-limited-even-on-timedtext":"no-usable-timedtext-exposed",
    policy:"This endpoint bypasses YouTube watch-page scraping and tests the timedtext service directly. Transcript text is still diagnostic only; no runner workout score is assigned without runner-specific verification.",
    next:matchedRunners.length>0?"Verify horse-level segments, persist verified workout evidence, and replace proxy condition scores only for verified runners.":"Stop spending requests on race-level YouTube if this route also fails. Keep the 10-point condition block explicitly provisional and move development to runner-level/manual evidence plus post-race backtest validation."
  };
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.5.0",phase:"direct timedtext fallback diagnostics"});
    if(url.pathname==="/v1/lab/workout-timedtext"){
      if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
      try{return json(await timedtextDiagnostics(request,env,ctx))}catch(e){return json({ok:false,version:"2.5.0",error:String(e)},500)}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
