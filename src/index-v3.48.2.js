import app from './index-v3.47.0.js';
import {sourceFor,expectedAge} from './expected-runner-preview-v3.30.0.js';
import {collectSupplementalCard,readSupplementalCard,supplementalCardPage,TARGET} from './supplemental-numbered-card.js';
export const VERSION='3.48.19';
export function addAppHomeNavigation(html){if(html.includes('id="labo-app-home"'))return html;const nav='<nav id="labo-app-home" aria-label="アプリへ戻る" style="position:sticky;top:0;z-index:100;background:#101e29;padding:10px 16px;border-bottom:1px solid #294151"><a href="https://keiba-lab-apl.vercel.app/" style="display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #88c7ff;border-radius:8px;color:#edf5fd;text-decoration:none;font:700 16px system-ui">← ホームへ戻る</a></nav>';if(/<body[^>]*>/i.test(html))return html.replace(/<body[^>]*>/i,tag=>tag+nav);return html.replace(/<main\b/i,nav+'<main');}
export async function runScheduledToCompletion(handler,event,env,ctx){const pending=[];await handler.scheduled(event,env,{waitUntil(promise){pending.push(Promise.resolve(promise));ctx.waitUntil(promise);}});await Promise.all(pending);}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/v1/lab/supplemental-card'&&request.method==='GET'){
  if(u.searchParams.get('date')!==TARGET.date||u.searchParams.get('venue')!==TARGET.venue||Number(u.searchParams.get('race_no'))!==TARGET.raceNo)return new Response(JSON.stringify({ok:false,version:VERSION,error:'対象はアイルランドTのみです。'}),{status:400,headers:{'content-type':'application/json; charset=UTF-8'}});
  const card=await readSupplementalCard(env.DB);return new Response(JSON.stringify({ok:true,version:VERSION,card,officialNumberVerification:false,source:TARGET.sourceUrl}),{headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}});
 }
 if(u.pathname==='/v1/lab/supplemental-card'&&request.method==='POST'){
  let body={};try{body=await request.json()}catch{}
  if(body.confirm!=='COLLECT')return new Response(JSON.stringify({ok:false,version:VERSION,error:'confirm COLLECT が必要です。'}),{status:400,headers:{'content-type':'application/json; charset=UTF-8'}});
  try{return new Response(JSON.stringify({...await collectSupplementalCard(env.DB),version:VERSION}),{headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}})}catch(e){return new Response(JSON.stringify({ok:false,version:VERSION,error:String(e.message||e)}),{status:502,headers:{'content-type':'application/json; charset=UTF-8'}})}
 }
 if(u.pathname==='/lab/supplemental-card'&&request.method==='GET')return new Response(supplementalCardPage(await readSupplementalCard(env.DB)),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store'}});
 const r=await app.fetch(request,env,ctx);
 let d;try{d=await r.clone().json();}catch{if(u.pathname.startsWith('/lab/')&&(r.headers.get('content-type')||'').includes('text/html')){const headers=new Headers(r.headers);headers.delete('content-length');headers.delete('etag');headers.set('cache-control','no-store');return new Response(addAppHomeNavigation(await r.text()),{status:r.status,headers});}return r;}if(d&&typeof d==='object'){d.version=VERSION;if(u.pathname==='/v1/lab/expected-runners'&&d.ok&&u.searchParams.has('date')){const source=sourceFor({date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});d.runners=d.runners.map(r=>({...r,age:expectedAge(source,r.horseName)}));}}return new Response(JSON.stringify(d,null,2),{status:r.status,headers:r.headers});
},async scheduled(event,env,ctx){return runScheduledToCompletion(app,event,env,ctx);}};
