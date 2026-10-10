import app from './index-v3.48.2.js';
import {workoutEndpoint} from './workout-evidence-v3.49.0.js';
export const VERSION='3.49.1';
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/v1/lab/workouts'||u.pathname==='/v1/lab/workouts/sync'){
   const response=await workoutEndpoint(request,env);
   const data=await response.json();
   return new Response(JSON.stringify({...data,version:VERSION}),{status:response.status,headers:response.headers});
  }
  const response=await app.fetch(request,env,ctx);
  let data;try{data=await response.clone().json();}catch{return response;}
  if(data&&typeof data==='object')data.version=VERSION;
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}
};
