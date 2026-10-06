import app from './index-v3.42.0.js';
import {assessmentContext} from './race-history-assessment-v3.31.0.js';
import {assessmentChooser} from './race-assessment-chooser-v3.31.0.js';
import {reviewNotePage} from './review-note-page-v3.43.0.js';
import {composeReviewArticle} from './review-note-core-v3.43.0.js';
import {CORE_JS,CLIENT_JS,WATCH_JS} from './review-note-browser-source-v3.43.0.js';
export const VERSION='3.43.0';
const json=(d,status=200)=>new Response(JSON.stringify(d,null,2),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*'}});
const html=body=>new Response(body,{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const js=body=>new Response(body,{headers:{'content-type':'text/javascript; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function chooser(date,message=''){return assessmentChooser(date,message).replaceAll('全レースの過去DB精査','回顧メモ・note記事').replace('action="/lab/history-assessment"','action="/lab/note-review"').replace('出走馬を開いて初期印を付ける','回顧メモと記事を開く').replace('保存済みJRA出馬表のあるレースを選び、全出走馬の過去走から初期印を精査できます。公開前の想定馬は、確認済みの一覧があるレースで利用できます。','開催日以降のレースを選んで、回顧メモを保存し、保存済み結果からnote用本文を作成できます。').replace('参考評価は的中確率ではありません。履歴が少ない馬・取得できていない項目は明示します。','回顧メモはこのブラウザ内に保存します。結果の未取得項目や未確認の事前印は本文に明記します。');}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'review-memos-note-article-next-start-observations',now:new Date().toISOString()});
 if(u.pathname==='/lab/review-note-core.js')return js(CORE_JS);
 if(u.pathname==='/lab/review-note-client.js')return js(CLIENT_JS);
 if(u.pathname==='/lab/watch-notes.js')return js(WATCH_JS);
 if(u.pathname==='/lab/note-review'&&request.method==='GET'){
  const date=u.searchParams.get('date')||today();if(!u.searchParams.has('date'))return html(chooser(date));
  try{if(date>today())throw Error('回顧画面は対象レースの開催日以降に利用できます。');const source=await assessmentContext(env.DB,{date,venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});if(!source.official)throw Error('保存済みの正式出馬表が必要です。');return html(reviewNotePage(source));}catch(e){return html(chooser(date,e.message));}
 }
 if(u.pathname==='/v1/lab/note-review'&&request.method==='GET'){
  const hu=new URL(u);hu.pathname='/v1/lab/history/race';const r=await app.fetch(new Request(hu.href,{headers:request.headers}),env,ctx);const d=await r.json();if(!r.ok||!d.ok)return json({...d,version:VERSION},r.status);
  return json({ok:true,version:VERSION,mode:'review',format:'plain-text',copyReady:true,race:d.race,text:composeReviewArticle(d),memoStorage:'browser-local',guardrails:{noPostRacePredictionReconstruction:true,noAutomaticMemoTraining:true}});
 }
 const r=await app.fetch(request,env,ctx);
 if(request.method==='GET'&&['/lab/history-assessment','/lab/mark-comparison','/lab/expected-preview'].includes(u.pathname)&&r.headers.get('content-type')?.includes('text/html')){
  let body=await r.text();let target;try{target=JSON.parse(body.match(/id="comparisonTarget">([\s\S]*?)<\/script>/)?.[1]||'null');}catch{}
  const href='/lab/note-review'+(target?'?'+new URLSearchParams({date:target.date,venue:target.venue,race_no:String(target.raceNo)}):'');
  body=body.replace('<h1>','<p><a href="'+href+'">回顧メモ・note記事を開く</a></p><h1>');
  if(target)body=body.replace(/(<form\b[^>]*id="previewForm"[^>]*>)/,'<section class="card"><h2>前走からの次走注目メモ</h2><p id="watchNotes" style="white-space:pre-wrap;overflow-wrap:anywhere" role="status"></p></section>$1').replace('</body>','<script type="module" src="/lab/watch-notes.js"></script></body>');
  return new Response(body,{status:r.status,headers:r.headers});
 }
 let d;try{d=await r.clone().json();}catch{return r;}if(d&&typeof d==='object')d.version=VERSION;return json(d,r.status);
},async scheduled(event,env,ctx){return app.scheduled(event,env,ctx);}};
