import app from './index-v3.34.0.js';
import {freezeExperiment,captureExperimentRace,fitExperiment,experimentStatus,scheduledExperiment} from './learning-experiment-v3.35.0.js';
import {experimentPage} from './learning-experiment-page-v3.35.0.js';
export const VERSION='3.35.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'immutable shadow-learning experiment'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'frozen-shadow-learning-experiment',now:new Date().toISOString()});
  if(u.pathname==='/lab/learning-experiment'&&request.method==='GET')return new Response(experimentPage(),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  try{
   if(u.pathname==='/v1/lab/learning-experiment'&&request.method==='GET')return json({...await experimentStatus(env.DB),version:VERSION});
   if(u.pathname==='/v1/lab/learning-experiment-freeze'&&request.method==='POST'){const b=await request.json();if(b.confirm!=='FREEZE')throw Error('confirm FREEZE is required');const p=await freezeExperiment(env.DB);return json({ok:true,protocolFrozenAt:p.frozen_at,idempotent:p.idempotent,...await experimentStatus(env.DB),version:VERSION});}
   if(u.pathname==='/v1/lab/learning-experiment-capture'&&request.method==='POST'){const b=await request.json();if(b.confirm!=='CAPTURE')throw Error('confirm CAPTURE is required');return json({...await captureExperimentRace(env.DB,b),version:VERSION});}
   if(u.pathname==='/v1/lab/learning-experiment-fit'&&request.method==='POST'){const b=await request.json();if(b.confirm!=='FIT')throw Error('confirm FIT is required');return json({...await fitExperiment(env.DB),version:VERSION});}
  }catch(error){return json({ok:false,error:String(error.message||error),version:VERSION},400)}
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{if(u.pathname==='/lab/learning-status')return new Response((await response.text()).replace('自動学習・評価の重みの更新：未実装','本番予想の重みの自動更新：未実装（学習候補の作成は別画面）').replace('</main>','<p><a href="/lab/learning-experiment">固定した条件で学習候補を比較する</a></p></main>'),{status:response.status,headers:response.headers});return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){if(event.cron==='15 * * * *'){ctx.waitUntil(scheduledExperiment(env.DB).then(result=>console.log('learning-experiment',JSON.stringify(result))).catch(error=>{console.error('learning-experiment-failed',String(error));throw error}));return}return app.scheduled(event,env,ctx)}
};
