import app from './index-v3.46.0.js';
export const VERSION='3.46.1';
export default{async fetch(request,env,ctx){
 const r=await app.fetch(request,env,ctx);let d;try{d=await r.clone().json();}catch{return r;}
 if(d&&typeof d==='object')d.version=VERSION;
 return new Response(JSON.stringify(d,null,2),{status:r.status,headers:r.headers});
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
