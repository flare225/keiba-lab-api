import app from "./index-v2.4.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}

async function invoke(origin,path,params,env,ctx){
  const u=new URL(path,origin);
  for(const[k,v]of Object.entries(params||{}))if(v!=null)u.searchParams.set(k,String(v));
  const r=await app.fetch(new Request(u.href,{method:"GET"}),env,ctx);
  let d;try{d=await r.json()}catch{d={ok:false,error:`non-json response (${r.status})`}}
  return{status:r.status,data:d};
}

function youtubeId(href){
  try{
    const u=new URL(href);
    if(/youtu\.be$/i.test(u.hostname))return u.pathname.split("/").filter(Boolean)[0]||null;
    if(/youtube\.com$/i.test(u.hostname)||/www\.youtube\.com$/i.test(u.hostname)){
      if(u.pathname==="/watch")return u.searchParams.get("v");
      const m=u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/i);
      if(m)return m[1];
    }
  }catch{}
  return null;
}

async function fetchOEmbed(id){
  if(!id)return{ok:false,status:null,error:"video id not parsed"};
  const watch=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
  try{
    const r=await fetch(endpoint,{headers:{"user-agent":"keiba-lab/2.4.1 (+youtube workout metadata diagnostics)",accept:"application/json"},redirect:"follow"});
    let data=null;try{data=await r.json()}catch{}
    return{ok:r.ok,status:r.status,watchUrl:watch,title:data?.title??null,authorName:data?.author_name??null,authorUrl:data?.author_url??null,thumbnailUrl:data?.thumbnail_url??null};
  }catch(e){return{ok:false,status:null,error:String(e),watchUrl:watch}}
}

async function workoutVideoMeta(request,env,ctx){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  const featureId=url.searchParams.get("feature_id")||null;

  const source=await invoke(url.origin,"/v1/lab/workout-source",{date,venue,race_no:raceNo,feature_id:featureId},env,ctx);
  if(source.status>=400||source.data?.ok===false)throw new Error(`workout source failed: ${source.data?.error||source.status}`);

  const raceKey=source.data?.race?.raceKey;
  const rr=await env.DB.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(raceKey).all();
  const runners=rr.results||[];
  const links=Array.isArray(source.data?.youtubeLinks)?source.data.youtubeLinks:[];
  const seen=new Set();
  const videos=[];

  for(const link of links){
    const id=youtubeId(link?.href||"");
    if(!id||seen.has(id))continue;
    seen.add(id);
    const meta=await fetchOEmbed(id);
    const haystack=`${link?.anchorText||""} ${meta?.title||""}`;
    const matches=runners.filter(r=>haystack.includes(r.horse_name)).map(r=>({horseNo:r.horse_no,horseName:r.horse_name}));
    videos.push({videoId:id,sourceHref:link?.href||null,anchorText:link?.anchorText||null,...meta,runnerMatches:matches});
  }

  const matchedHorseNos=new Set(videos.flatMap(v=>v.runnerMatches.map(x=>Number(x.horseNo))));
  const matchedRunners=runners.filter(r=>matchedHorseNos.has(Number(r.horse_no)));
  const unmatchedRunners=runners.filter(r=>!matchedHorseNos.has(Number(r.horse_no)));
  const usable=matchedRunners.length>0;

  return{
    ok:true,stage:"official-workout-video-metadata-diagnostics",version:"2.4.1",
    race:source.data?.race||{date,venue,raceNo},
    sourceMoviePage:source.data?.moviePage||null,
    youtubeLinkCount:links.length,
    uniqueVideoCount:videos.length,
    videos,
    runnerTitleMatches:{matched:matchedRunners.length,runnerCount:runners.length,coveragePct:runners.length?Math.round(matchedRunners.length/runners.length*1000)/10:0,matchedRunners,unmatchedRunners},
    sourceUsability:usable?"runner-specific-title-evidence-present":"race-level-video-only-or-no-runner-names",
    policy:"YouTube metadata is diagnostic only. A race-level video title is not enough to assign runner-specific workout scores. Final workout scoring stays blocked unless horse-level evidence is structurally identifiable.",
    next:usable?"Map verified horse-level video metadata/chapters to runners, then replace proxy condition scores only for verified horses.":"Do not promote finalPrediction=true yet. Keep condition proxy provisional and inspect another official horse-level workout/condition source."
  };
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.4.1",phase:"official workout YouTube metadata diagnostics"});
    if(url.pathname==="/v1/lab/workout-video-meta"){
      if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);
      try{return json(await workoutVideoMeta(request,env,ctx))}catch(e){return json({ok:false,version:"2.4.1",error:String(e)},500)}
    }
    return app.fetch(request,env,ctx);
  },
  async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}
};
