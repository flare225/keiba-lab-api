import app from './index-v3.41.0.js';
import {assessmentContext} from './race-history-assessment-v3.31.0.js';
import {assessmentChooser} from './race-assessment-chooser-v3.31.0.js';
import {EXPECTED_SOURCES} from './expected-runner-preview-v3.30.0.js';
import {comparisonPage} from './mark-comparison-page-v3.42.0.js';
import {reviewCardContext} from './review-card-context-v3.42.0.js';
import {CLIENT_JS,REVIEW_JS} from './mark-comparison-browser-source-v3.42.0.js';
export const VERSION='3.42.0';
const headers={'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers});
const html=(body,status=200)=>new Response(body,{status,headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const js=body=>new Response(body,{headers:{'content-type':'text/javascript; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'local-stage-review-checkpoints-verified-frame-context',now:new Date().toISOString()});
 if(u.pathname==='/lab/mark-comparison-client.js')return js(CLIENT_JS);
 if(u.pathname==='/lab/comparison-review.js')return js(REVIEW_JS);
 if(request.method==='GET'&&['/lab/history-assessment','/lab/mark-comparison','/lab/expected-preview'].includes(u.pathname)){
  const date=u.searchParams.get('date')||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(u.pathname!=='/lab/expected-preview'&&!u.searchParams.has('date'))return html(assessmentChooser(date));
  try{const source=u.pathname==='/lab/expected-preview'&&!u.searchParams.has('date')?{...EXPECTED_SOURCES[0],official:false}:await assessmentContext(env.DB,{date,venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});const reviewMeta=await reviewCardContext(env.DB,source,source);return html(comparisonPage({...source,reviewMeta}));}catch(e){return html(assessmentChooser(date,String(e.message||e)),409);}
 }
 const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json();}catch{return response;}
 if(response.ok&&request.method==='POST'&&['/v1/lab/mark-comparison','/v1/lab/race-history-assessment','/v1/lab/expected-runner-assessment'].includes(u.pathname)){
  try{data.reviewMeta=await reviewCardContext(env.DB,data.race,data.source);}catch(e){return json({ok:false,error:'出馬表の比較情報を確認できません。再確認してください。',version:VERSION},503);}
 }
 if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
