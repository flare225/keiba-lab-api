import app from './index-v3.33.0.js';
import {learningReadiness} from './learning-readiness-v3.34.0.js';
import {learningPage} from './learning-page-v3.34.0.js';
export const VERSION='3.34.0';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(u.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'strict prospective learning readiness'});
  if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'prospective-learning-readiness',now:new Date().toISOString()});
  if(u.pathname==='/lab/learning-status'&&request.method==='GET')return new Response(learningPage(),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  if(u.pathname==='/v1/lab/learning-status'&&request.method==='GET'){try{return json({...await learningReadiness(env.DB,{from:u.searchParams.get('from')||undefined,to:u.searchParams.get('to')||undefined,track:u.searchParams.get('track')||undefined,splitDate:u.searchParams.get('splitDate')||undefined}),version:VERSION})}catch(error){return json({ok:false,error:String(error.message||error),version:VERSION},400)}}
  const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{if(u.pathname==='/lab/result-collection')return new Response((await response.text()).replace('</main>','<p><a href="/lab/learning-status">学習の準備状況へ</a></p></main>'),{status:response.status,headers:response.headers});return response}if(data&&typeof data==='object')data.version=VERSION;return json(data,response.status);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
