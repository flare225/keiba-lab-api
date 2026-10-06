import app from './index-v3.44.0.js';
import {workProgress} from './work-progress-v3.45.0.js';
import {workProgressPage} from './work-progress-page-v3.45.0.js';
import {CLIENT_JS} from './work-progress-browser-source-v3.45.0.js';
import {composeReviewArticle} from './review-note-core-v3.43.0.js';
import {normalizeHistoryStatuses} from './automatic-review-v3.44.0.js';
export const VERSION='3.45.0';
const json=(d,status=200)=>new Response(JSON.stringify(d,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*'}});
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'read-only-learning-work-progress-japanese-result-status',now:new Date().toISOString()});
 if(u.pathname==='/lab/work-progress'&&request.method==='GET')return new Response(workProgressPage(),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(u.pathname==='/lab/work-progress-client.js')return new Response(CLIENT_JS,{headers:{'content-type':'text/javascript; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(u.pathname==='/v1/lab/work-progress'&&request.method==='GET'){try{return json({...await workProgress(env.DB),version:VERSION});}catch(e){return json({ok:false,version:VERSION,error:'保存済みの進捗を確認できません。再確認してください。'},503);}}
 if(u.pathname==='/v1/lab/note-review'&&request.method==='GET'){
  const hu=new URL(u);hu.pathname='/v1/lab/history/race';const r=await app.fetch(new Request(hu.href,{headers:request.headers}),env,ctx),d=await r.json();if(!r.ok||!d.ok)return json({...d,version:VERSION},r.status);return json({ok:true,version:VERSION,mode:'review',format:'plain-text',copyReady:true,race:d.race,text:composeReviewArticle(normalizeHistoryStatuses(d)),memoStorage:'browser-local',guardrails:{noPostRacePredictionReconstruction:true,noAutomaticMemoTraining:true}});
 }
 const r=await app.fetch(request,env,ctx);
 if(request.method==='GET'&&r.headers.get('content-type')?.includes('text/html')&&['/lab/history-assessment','/lab/expected-preview','/lab/mark-comparison','/lab/note-review','/lab/learning-experiment'].includes(u.pathname))return new Response((await r.text()).replace(/(<main\b[^>]*>)/,'$1<p><a href="/lab/work-progress">補完・学習の進捗を見る</a></p>'),{status:r.status,headers:r.headers});
 let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object')d.version=VERSION;return json(d,r.status);
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
