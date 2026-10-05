import app from "./index-v2.4.1.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
async function invoke(origin,path,params,env,ctx){const u=new URL(path,origin);for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}return{status:r.status,data:d}}
function decodeJsonString(raw){try{return JSON.parse(`"${raw}"`)}catch{return String(raw||"").replace(/\\n/g,"\n").replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\"/g,'"').replace(/\\\\/g,"\\")}}
async function fetchWatch(id){const url=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=ja`;try{const r=await fetch(url,{headers:{"user-agent":"keiba-lab/2.4.2 (+youtube description diagnostics)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});const body=await r.text();const titleM=body.match(/"title":"((?:\\.|[^"\\])*)"/);const descM=body.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);const title=titleM?decodeJsonString(titleM[1]):null;const description=descM?decodeJsonString(descM[1]):null;return{ok:r.ok,status:r.status,url:r.url,title,description,htmlLength:body.length}}catch(e){return{ok:false,status:null,error:String(e),url}}}
function timestampLines(text){return String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(s=>/(?:^|\s)\d{1,2}:\d{2}(?::\d{2})?/.test(s)).slice(0,60)}

async function details(request,env,ctx){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  const featureId=url.searchParams.get("feature_id")||null;
  const base=await invoke(url.origin,"/v1/lab/workout-video-meta",{date,venue,race_no:raceNo,feature_id:featureId},env,ctx);
  if(base.status>=400||base.data?.ok===false)throw new Error(`video metadata failed: ${base.data?.error||base.status}`);
  const raceKey=base.data?.race?.raceKey;
  const rr=await env.DB.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(raceKey).all();
  const runners=rr.results||[];
  const videos=[];
  for(const v of base.data?.videos||[]){
    const detail=await fetchWatch(v.videoId);
    const haystack=`${v.title||""}\n${detail.title||""}\n${detail.description||""}`;
    const runnerMatches=runners.filter(r=>haystack.includes(r.horse_name)).map(r=>({horseNo:r.horse_no,horseName:r.horse_name}));
    videos.push({videoId:v.videoId,oembedTitle:v.title||null,watchTitle:detail.title||null,watchFetched:detail.ok,watchHttpStatus:detail.status,descriptionLength:detail.description?.length||0,descriptionSample:detail.description?detail.description.slice(0,2200):null,timestampLines:timestampLines(detail.description),runnerMatches});
  }
  const matchedHorseNos=new Set(videos.flatMap(v=>v.runnerMatches.map(x=>Number(x.horseNo))));
  const matchedRunners=runners.filter(r=>matchedHorseNos.has(Number(r.horse_no)));
  return{
    ok:true,stage:"official-workout-video-description-diagnostics",version:"2.4.2",
    race:base.data?.race||{date,venue,raceNo},videoCount:videos.length,videos,
    runnerDescriptionMatches:{matched:matchedRunners.length,runnerCount:runners.length,coveragePct:runners.length?Math.round(matchedRunners.length/runners.length*1000)/10:0,matchedRunners,unmatchedRunners:runners.filter(r=>!matchedHorseNos.has(Number(r.horse_no)))},
    sourceUsability:matchedRunners.length>0?"runner-specific-description-evidence-present":"race-level-video-description-no-runner-names",
    policy:"YouTube watch-page descriptions are used only to discover runner-specific labels/timestamps. No workout quality score is assigned from a race-level video unless horse-level evidence is explicitly identified.",
    next:matchedRunners.length>0?"Map horse-specific timestamps/segments and persist verified workout evidence.":"Official race-level videos still do not expose horse-level labels. Keep the condition block provisional and inspect another official horse-level source."
  };
}

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.4.2",phase:"official workout YouTube description diagnostics"});if(url.pathname==="/v1/lab/workout-video-details"){if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{return json(await details(request,env,ctx))}catch(e){return json({ok:false,version:"2.4.2",error:String(e)},500)}}return app.fetch(request,env,ctx)},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
