import app from './index-v3.47.0.js';
import {sourceFor,expectedAge} from './expected-runner-preview-v3.30.0.js';
export const VERSION='3.48.1';
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 const r=await app.fetch(request,env,ctx);
 let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object'){d.version=VERSION;if(u.pathname==='/v1/lab/expected-runners'&&d.ok&&u.searchParams.has('date')){const source=sourceFor({date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});d.runners=d.runners.map(r=>({...r,age:expectedAge(source,r.horseName)}));}}return new Response(JSON.stringify(d,null,2),{status:r.status,headers:r.headers});
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
