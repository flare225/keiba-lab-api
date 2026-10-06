import app from './index-v3.43.0.js';
import {reviewNotePage} from './review-note-page-v3.44.0.js';
import {buildAutomaticReview} from './automatic-review-v3.44.0.js';
import {AUTO_JS,CLIENT_JS} from './review-note-browser-source-v3.44.0.js';
export const VERSION='3.44.0';
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*'}});
const js=body=>new Response(body,{headers:{'content-type':'text/javascript; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'stored-result-automatic-review-draft-safe-merge',now:new Date().toISOString()});
 if(u.pathname==='/lab/automatic-review.js')return js(AUTO_JS);
 if(u.pathname==='/lab/review-note-client.js')return js(CLIENT_JS);
 if(u.pathname==='/v1/lab/automatic-review'&&request.method==='GET'){
  const hu=new URL(u);hu.pathname='/v1/lab/history/race';const r=await app.fetch(new Request(hu.href,{headers:request.headers}),env,ctx),d=await r.json();if(!r.ok||!d.ok)return json({...d,version:VERSION},r.status);
  try{return json({ok:true,version:VERSION,race:d.race,reviewDraft:buildAutomaticReview(d,{focusHorseName:u.searchParams.get('focus')||null})});}catch(e){return json({ok:false,version:VERSION,error:e.message},400);}
 }
 const r=await app.fetch(request,env,ctx);
 if(u.pathname==='/lab/note-review'&&request.method==='GET'&&u.searchParams.has('date')){
  const text=await r.text();if(!text.includes('id="reviewTarget"'))return new Response(text,{status:r.status,headers:r.headers});
  // Reuse the existing page's validated identity; no second database query is needed.
  const target=JSON.parse(text.match(/id="reviewTarget"[^>]*>([\s\S]*?)<\/script>/)[1]),name=text.match(/<h1>回顧メモ・note記事<\/h1><p>([\s\S]*?)<\/p>/)?.[1]||'';
  const source={...target,raceName:''};let body=reviewNotePage(source);body=body.replace('<h1>回顧メモ・note記事</h1><p>'+target.date+' '+target.venue+target.raceNo+'R </p>','<h1>回顧メモ・note記事</h1><p>'+name+'</p>');return new Response(body,{status:r.status,headers:r.headers});
 }
 let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object')d.version=VERSION;return json(d,r.status);
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
