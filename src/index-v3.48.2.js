import app from './index-v3.47.0.js';
import {sourceFor,expectedAge} from './expected-runner-preview-v3.30.0.js';
export const VERSION='3.48.18';
export function addAppHomeNavigation(html){if(html.includes('id="labo-app-home"'))return html;const nav='<nav id="labo-app-home" aria-label="アプリへ戻る" style="position:sticky;top:0;z-index:100;background:#101e29;padding:10px 16px;border-bottom:1px solid #294151"><a href="https://keiba-lab-apl.vercel.app/" style="display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #88c7ff;border-radius:8px;color:#edf5fd;text-decoration:none;font:700 16px system-ui">← ホームへ戻る</a></nav>';if(/<body[^>]*>/i.test(html))return html.replace(/<body[^>]*>/i,tag=>tag+nav);return html.replace(/<main\b/i,nav+'<main');}
export async function runScheduledToCompletion(handler,event,env,ctx){const pending=[];await handler.scheduled(event,env,{waitUntil(promise){pending.push(Promise.resolve(promise));ctx.waitUntil(promise);}});await Promise.all(pending);}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 const r=await app.fetch(request,env,ctx);
 let d;try{d=await r.clone().json();}catch{if(u.pathname.startsWith('/lab/')&&(r.headers.get('content-type')||'').includes('text/html')){const headers=new Headers(r.headers);headers.delete('content-length');headers.delete('etag');headers.set('cache-control','no-store');return new Response(addAppHomeNavigation(await r.text()),{status:r.status,headers});}return r;}if(d&&typeof d==='object'){d.version=VERSION;if(u.pathname==='/v1/lab/expected-runners'&&d.ok&&u.searchParams.has('date')){const source=sourceFor({date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});d.runners=d.runners.map(r=>({...r,age:expectedAge(source,r.horseName)}));}}return new Response(JSON.stringify(d,null,2),{status:r.status,headers:r.headers});
},async scheduled(event,env,ctx){return runScheduledToCompletion(app,event,env,ctx);}};
