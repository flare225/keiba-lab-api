import app from './index-v3.40.1.js';
import {assessmentContext,raceHistoryAssessment} from './race-history-assessment-v3.31.0.js';
import {expectedAssessment} from './expected-assessment-v3.31.0.js';
import {assessmentChooser} from './race-assessment-chooser-v3.31.0.js';
import {comparisonPage} from './mark-comparison-page-v3.41.0.js';
import {buildMarkComparison} from './mark-comparison-core-v3.41.0.js';
import {CORE_JS,CLIENT_JS} from './mark-comparison-browser-source-v3.41.0.js';
export const VERSION='3.41.0';
const headers={'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers});
const html=(body,status=200)=>new Response(body,{status,headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const js=body=>new Response(body,{headers:{'content-type':'text/javascript; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'instant-mark-comparison-evidence-and-gaps',now:new Date().toISOString()});
  if(u.pathname==='/lab/mark-comparison-core.js')return js(CORE_JS);
  if(u.pathname==='/lab/mark-comparison-client.js')return js(CLIENT_JS);
  if(request.method==='GET'&&['/lab/history-assessment','/lab/mark-comparison','/lab/expected-preview'].includes(u.pathname)){
   if(u.pathname==='/lab/expected-preview'&&!u.searchParams.has('date'))return html(comparisonPage());
   const date=u.searchParams.get('date')||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(!u.searchParams.has('date'))return html(assessmentChooser(date));
   try{return html(comparisonPage(await assessmentContext(env.DB,{date,venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')})));}catch(e){return html(assessmentChooser(date,String(e.message||e)),409);}
  }
  if(request.method==='POST'&&['/v1/lab/mark-comparison','/v1/lab/race-history-assessment','/v1/lab/expected-runner-assessment'].includes(u.pathname)){
   try{const body=await request.json();if(body.phase&&body.phase!=='initial')throw Error('この比較は初期印用です。正式な枠順後・当日の印保存とは区別します。');const data=await (u.pathname.endsWith('expected-runner-assessment')?expectedAssessment(env.DB,body):raceHistoryAssessment(env.DB,body));return json({...data,comparison:buildMarkComparison(data),version:VERSION});}catch(e){const error=String(e.message||e);return json({ok:false,error,version:VERSION},/過去DB/.test(error)?503:400);}
  }
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json();}catch{return response;}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}
};
