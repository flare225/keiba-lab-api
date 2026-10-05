import app from "./index-v2.3.0.js";

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","access-control-allow-origin":"*"}})}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")}
function cleanText(v){return String(v||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim()}
async function fetchHtml(url){const r=await fetch(url,{headers:{"user-agent":"keiba-lab/2.4.0 (+official workout source diagnostics)",accept:"text/html,*/*;q=0.8"},redirect:"follow"});const b=await r.arrayBuffer();let body;try{body=new TextDecoder("shift_jis").decode(b)}catch{body=new TextDecoder("utf-8").decode(b)}return{ok:r.ok,status:r.status,url:r.url,body}}
function extractLinks(html,base){const out=[],seen=new Set();const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){try{const href=new URL(m[1].replace(/&amp;/g,"&"),base).href;if(seen.has(href))continue;seen.add(href);out.push({anchorText:cleanText(m[2]),href})}catch{}}return out}
function featuredIdFromHref(href){const m=String(href||"").match(/\/keiba\/race\/(\d{3})(?:\/|\.html|$)/i);return m?m[1]:null}
function contextAround(text,needle,radius=220){const i=text.indexOf(needle);if(i<0)return null;return text.slice(Math.max(0,i-radius),Math.min(text.length,i+needle.length+radius))}

async function workoutSource(request,env){
  const url=new URL(request.url),date=url.searchParams.get("date"),venue=url.searchParams.get("venue"),raceNo=Number(url.searchParams.get("race_no"));
  if(!validDate(date)||!venue||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  const race=await env.DB.prepare(`SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,source_url FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date,venue,raceNo).first();
  if(!race)throw new Error("race not found in D1");
  const rr=await env.DB.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  const runners=rr.results||[];
  if(!race.source_url)throw new Error("race source_url missing");

  const card=await fetchHtml(race.source_url);
  if(!card.ok)throw new Error(`race card HTTP ${card.status}`);
  const links=extractLinks(card.body,card.url);
  const discovered=[...new Set(links.map(x=>featuredIdFromHref(x.href)).filter(Boolean))];
  const requestedId=url.searchParams.get("feature_id");
  const featureId=requestedId||discovered[0]||null;
  const movieUrl=featureId?`https://www.jra.go.jp/keiba/race/${featureId}/movie.html`:null;

  let movie=null,movieText="",movieLinks=[];
  if(movieUrl){movie=await fetchHtml(movieUrl);if(movie.ok){movieText=cleanText(movie.body);movieLinks=extractLinks(movie.body,movie.url)}}

  const mentions=runners.map(r=>({horseNo:r.horse_no,horseName:r.horse_name,mentioned:movieText.includes(r.horse_name),context:contextAround(movieText,r.horse_name)}));
  const mentioned=mentions.filter(x=>x.mentioned).length;
  const youtubeLinks=movieLinks.filter(x=>/youtube\.com|youtu\.be/i.test(x.href));
  const timeLike=(movieText.match(/\b(?:\d{1,2}:)?\d{1,2}\.\d\b/g)||[]).slice(0,40);

  return{
    ok:Boolean(movie?.ok),stage:"official-workout-page-diagnostics",version:"2.4.0",
    race:{raceKey:race.race_key,date:race.race_date,venue:race.venue,raceNo:race.race_no,raceName:race.race_name,surface:race.surface,distance:race.distance,runnerCount:runners.length},
    featureDiscovery:{requestedFeatureId:requestedId||null,discoveredFeatureIds:discovered,selectedFeatureId:featureId,cardLinkCount:links.length},
    moviePage:{url:movieUrl,httpStatus:movie?.status??null,fetched:Boolean(movie?.ok),textLength:movieText.length,youtubeLinkCount:youtubeLinks.length,timeLikeTokenCount:timeLike.length},
    runnerMentions:{mentioned,runnerCount:runners.length,coveragePct:runners.length?Math.round(mentioned/runners.length*1000)/10:0,samples:mentions.filter(x=>x.mentioned).slice(0,8),missing:mentions.filter(x=>!x.mentioned).map(x=>({horseNo:x.horseNo,horseName:x.horseName}))},
    youtubeLinks:youtubeLinks.slice(0,20),
    timeLikeSamples:timeLike,
    policy:"This endpoint only validates a JRA official featured-race workout page. It does not assign workout scores until runner-specific evidence is structurally confirmed.",
    next:mentioned>0?"Map runner-specific workout blocks/times from the official movie page and replace condition proxy scores where verified.":"If no runner names are present, inspect official movie/YouTube link structure and keep proxy condition scores provisional."
  };
}

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/")return json({ok:true,service:"keiba-lab-api",version:"2.4.0",phase:"official JRA workout source diagnostics"});if(url.pathname==="/v1/lab/workout-source"){if(!env.DB)return json({ok:false,error:"D1 binding DB is not configured"},500);try{return json(await workoutSource(request,env))}catch(e){return json({ok:false,version:"2.4.0",error:String(e)},500)}}return app.fetch(request,env,ctx)},async scheduled(event,env,ctx){if(app.scheduled)return app.scheduled(event,env,ctx)}};
