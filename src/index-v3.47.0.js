import app from './index-v3.46.1.js';
import {MAIN_EXPECTED_SOURCE} from './expected-runner-preview-v3.30.0.js';
export const VERSION='3.47.0';
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/lab/expected-preview'&&request.method==='GET'&&!u.searchParams.has('date')){
  u.searchParams.set('date',MAIN_EXPECTED_SOURCE.date);u.searchParams.set('venue',MAIN_EXPECTED_SOURCE.venue);u.searchParams.set('race_no',String(MAIN_EXPECTED_SOURCE.raceNo));request=new Request(u.href,request);
 }
 const r=await app.fetch(request,env,ctx);
 if(request.method==='GET'&&r.headers.get('content-type')?.includes('text/html')&&['/lab/expected-preview','/lab/work-progress','/lab/history-assessment'].includes(u.pathname))return new Response((await r.text()).replace(/(<main\b[^>]*>)/,'$1<p><b>今週のメイン：日曜アイルランドT</b> · <a href="/lab/expected-preview?date=2026-10-11&amp;venue=%E6%9D%B1%E4%BA%AC&amp;race_no=11">アイルランドTを精査</a> · <a href="/lab/expected-preview?date=2026-10-10&amp;venue=%E6%9D%B1%E4%BA%AC&amp;race_no=11">サウジRC（蓄積用）</a></p>'),{status:r.status,headers:r.headers});
 let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object')d.version=VERSION;return new Response(JSON.stringify(d,null,2),{status:r.status,headers:r.headers});
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
