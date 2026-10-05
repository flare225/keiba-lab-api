import app from "./index-v2.4.2.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}

function decodeEntities(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))}
function stripTags(s){return decodeEntities(String(s||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}

function extractJsonArrayAfter(html,marker){
  const start=html.indexOf(marker);
  if(start<0)return null;
  const open=html.indexOf("[",start+marker.length);
  if(open<0)return null;
  let depth=0,inString=false,escape=false;
  for(let i=open;i<html.length;i++){
    const ch=html[i];
    if(inString){if(escape){escape=false;continue}if(ch==="\\"){escape=true;continue}if(ch==='"')inString=false;continue}
    if(ch==='"'){inString=true;continue}
    if(ch==="[")depth++;
    else if(ch==="]"){depth--;if(depth===0)return html.slice(open,i+1)}
  }
  return null;
}

function extractCaptionTracks(html){
  const raw=extractJsonArrayAfter(html,'"captionTracks":');
  if(!raw)return[];
  try{return JSON.parse(raw)}catch{return[]}
}

async function fetchWatch(id){
  const u=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=ja`;
  try{
    const r=await fetch(u,{headers:{"user-agent":"keiba-lab/2.4.3 (+caption diagnostics)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});
    const body=await r.text();
    return{ok:r.ok,status:r.status,url:r.url,body};
  }catch(e){return{ok:false,status:null,url:u,error:String(e),body:""}}
}

function captionName(track){
  const runs=track?.name?.runs;
  if(Array.isArray(runs))return runs.map(x=>x?.text||"").join("").trim()||null;
  return track?.name?.simpleText||null;
}

async function fetchTranscript(baseUrl){
  if(!baseUrl)return{ok:false,status:null,text:"",format:"none"};
  try{
    const r=await fetch(baseUrl,{headers:{"user-agent":"keiba-lab/2.4.3 (+caption diagnostics)",accept:"text/xml,text/plain,*/*;q=0.8"},redirect:"follow"});
    const raw=await r.text();
    let text="",format="unknown";
    if(/<text\b/i.test(raw)){
      format="xml";
      const parts=[];
      for(const m of raw.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi))parts.push(stripTags(m[1]));
      text=parts.join(" ").replace(/\s+/g," ").trim();
    }else if(/^WEBVTT/m.test(raw)){
      format="vtt";
      text=raw.split(/\r?\n/).filter(line=>!/^WEBVTT/.test(line)&&!/^\d{1,2}:\d{2}/.test(line)&&!-->/.test(line)&&line.trim()).join(" ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    }else{
      format="raw";
      text=stripTags(raw);
    }
    return{ok:r.ok,status:r.status,text,format,rawLength:raw.length};
  }catch(e){return{ok:false,status:null,text:"",format:"error",error:String(e)}}
}

async function captionDiagnostics(request,env,ctx){
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
    const watch=await fetchWatch(v.videoId);
    const tracks=watch.ok?extractCaptionTracks(watch.body):[];
    const trackResults=[];
    for(const t of tracks.slice(0,4)){
      const transcript=await fetchTranscript(t.baseUrl);
      const matches=runners.filter(r=>transcript.text.includes(r.horse_name)).map(r=>({horseNo:r.horse_no,horseName:r.horse_name}));
      trackResults.push({languageCode:t.languageCode||null,kind:t.kind||null,name:captionName(t),isTranslatable:Boolean(t.isTranslatable),fetchOk:transcript.ok,httpStatus:transcript.status,format:transcript.format,textLength:transcript.text.length,textSample:transcript.text.slice(0,1800),runnerMatches:matches});
    }
    videos.push({videoId:v.videoId,title:v.title||null,watchFetched:watch.ok,watchHttpStatus:watch.status,captionTrackCount:tracks.length,captionTracks:trackResults});
  }

  const matchedNos=new Set(videos.flatMap(v=>v.captionTracks.flatMap(t=>t.runnerMatches.map(x=>Number(x.horseNo)))));
  const matchedRunners=runners.filter(r=>matchedNos.has(Number(r.horse_no)));
  const captionTracksFound=videos.reduce((n,v)=>n+v.captionTrackCount,0);
  return{
    ok:true,stage:"official-workout-video-caption-diagnostics",version:"2.4.3",
    race:meta.data?.race||{date,venue,raceNo},
    videoCount:videos.length,captionTracksFound,videos,
    runnerCaptionMatches:{matched:matchedRunners.length,runnerCount:runners.length,coveragePct:runners.length?Math.round(matchedRunners.length/runners.length*1000)/10:0,matchedRunners,unmatchedRunners:runners.filter(r=>!matchedNos.has(Number(r.horse_no)))},
    sourceUsability:matchedRunners.length>0?"horse-names-detected-in-official-video-captions":captionTracksFound>0?"captions-found-but-no-exact-horse-name-match":"no-caption-tracks-exposed",
    policy:"Caption text is used only as a discovery layer. Automatic captions can mistranscribe horse names, so no workout score is assigned until the detected segment can be tied to a runner with a second structural check.",
    next:matchedRunners.length>0?"Use caption hit positions plus video timing to isolate runner segments and verify them before workout scoring.":"If captions do not expose horse names, stop scraping race-level video metadata and switch to a runner-level workout source or explicit manual workout input."
  };
}

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.4.3",phase:"official workout caption diagnostics"});if(url.pathname==="/v1/lab/workout-video-captions"){if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{return json(await captionDiagnostics(request,env,ctx))}catch(e){return json({ok:false,version:"2.4.3",error:String(e)},500)}}return app.fetch(request,env,ctx)},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
