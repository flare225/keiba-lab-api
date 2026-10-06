import {buildAutomaticReview,applyReviewFields} from './automatic-review-v3.44.0.js';
import {MEMO_KEY,MEMO_FIELDS,parseMemoStore,createMemo,storeMemo,composeReviewArticle,upcomingWatch,memoRaceKey} from './review-note-core-v3.43.0.js';
export function initReviewNote({document,storage,fetcher=globalThis.fetch,clipboard,now=Date.now}){
 try{if(storage===undefined)storage=globalThis.localStorage;}catch{storage=null;}
 const target=JSON.parse(document.getElementById('reviewTarget').textContent),status=document.getElementById('memoStatus'),output=document.getElementById('articleText'),save=document.getElementById('saveMemo'),copy=document.getElementById('copyArticle');
 let registry={},readable=true,history=null,loadedSaved=false,autoDraft=null;const appliedFields=new Set();
 try{registry=parseMemoStore(storage?.getItem(MEMO_KEY));}catch(e){readable=false;status.textContent=e.message;}
 const existing=registry[memoRaceKey(target)];if(existing){for(const key of Object.keys(MEMO_FIELDS))document.getElementById('memo-'+key).value=existing.fields[key];for(const input of document.querySelectorAll('.watch-note'))input.value=existing.watch.find(w=>w.horseName===input.dataset.horse)?.note||'';for(const key of Array.isArray(existing.autoDraftFields)?existing.autoDraftFields:[])if(Object.hasOwn(MEMO_FIELDS,key))appliedFields.add(key);loadedSaved=true;status.textContent='保存済みの回顧メモを復元しました。保存先はこのブラウザ内です。';}
 if(!storage&&readable)status.textContent='このブラウザでは保存が利用できません。本文の作成・コピーは利用できます。';
 save.disabled=!storage||!readable;copy.disabled=true;
 const draft=()=>({fields:Object.fromEntries(Object.keys(MEMO_FIELDS).map(k=>[k,document.getElementById('memo-'+k).value.trim()])),watch:[...document.querySelectorAll('.watch-note')].filter(e=>e.value.trim()).map(e=>({horseName:e.dataset.horse,note:e.value.trim()}))});
 function render(){if(!history)return;output.value=composeReviewArticle(history,draft()).replace('回顧メモは手入力の観察です。','回顧メモは結果表の整理と入力した観察です。');copy.disabled=false;}
 function edited(){document.getElementById('draftStatus').textContent='編集内容は未保存です。本文には現在の入力を反映しています。';render();}
 function refreshAutoReview(){
  const autoStatus=document.getElementById('autoReviewStatus');
  try{autoDraft=history?buildAutomaticReview(history,{focusHorseName:document.getElementById('autoFocus').value||null}):null;
   for(const key of Object.keys(MEMO_FIELDS)){document.getElementById('auto-'+key).value=autoDraft?.fields?.[key]||'';document.getElementById('append-'+key).disabled=!autoDraft?.available;}
   document.getElementById('applyEmptyAuto').disabled=!autoDraft?.available;
   autoStatus.textContent=autoDraft?.available?'結果を確認して回顧案を作成しました。'+autoDraft.warnings.join(' '):autoDraft?.reason||'保存済み結果の表示後に回顧案を作れます。';
  }catch(e){autoDraft=null;document.getElementById('applyEmptyAuto').disabled=true;for(const key of Object.keys(MEMO_FIELDS)){document.getElementById('auto-'+key).value='';document.getElementById('append-'+key).disabled=true;}autoStatus.textContent='回顧案の作成を保留しています：'+e.message;}
 }
 function applyAuto(field=null){
  try{const result=applyReviewFields(draft().fields,autoDraft||{available:false},{field});for(const key of result.changed){document.getElementById('memo-'+key).value=result.fields[key];appliedFields.add(key);}if(result.changed.length)edited();document.getElementById('autoReviewStatus').textContent=result.changed.length+'項目を反映しました。'+(result.skipped.length?'入力済みの項目や文字数上限に達する項目は保持しています。':'内容を確認・修正してから回顧メモを保存してください。');}catch(e){document.getElementById('autoReviewStatus').textContent=e.message;}
 }
 document.getElementById('generateAutoReview').addEventListener('click',refreshAutoReview);document.getElementById('autoFocus').addEventListener('change',refreshAutoReview);document.getElementById('applyEmptyAuto').addEventListener('click',()=>applyAuto());
 for(const key of Object.keys(MEMO_FIELDS))document.getElementById('append-'+key).addEventListener('click',()=>applyAuto(key));
 async function load(){try{const p=new URLSearchParams({date:target.date,venue:target.venue,race_no:String(target.raceNo)}),r=await fetcher('/v1/lab/history/race?'+p),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'結果を確認できません。');if(memoRaceKey(d.race)!==memoRaceKey(target))throw Error('対象レースが一致しません。');history=d;refreshAutoReview();document.getElementById('resultStatus').textContent=d.result?.complete?'全馬の保存済み結果を本文に反映しました。上がり・通過順の未取得項目は明記します。':'結果は未取得または一部未取得です。本文では未取得のまま表示します。';render();}catch(e){document.getElementById('resultStatus').textContent='記事用データの取得を保留しています：'+e.message;copy.disabled=true;}}
 function saveMemo(){if(!storage||!readable)return;try{const d=draft(),memo=createMemo(target,d.fields,d.watch,now());memo.autoDraftFields=[...appliedFields];memo.autoDraftVersion=appliedFields.size?autoDraft?.version||existing?.autoDraftVersion||null:null;memo.humanReviewed=true;memo.manualObservation=appliedFields.size===0;const latest=parseMemoStore(storage.getItem(MEMO_KEY));const next=storeMemo(latest,memo);storage.setItem(MEMO_KEY,JSON.stringify(next));registry=next;loadedSaved=true;status.textContent='回顧メモと次走注目メモを、このブラウザ内に保存しました。';document.getElementById('draftStatus').textContent='保存済み · '+new Date(memo.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});render();}catch(e){status.textContent='保存できませんでした：'+e.message;}}
 async function copyText(){try{const api=clipboard||globalThis.navigator?.clipboard;if(!api)throw Error('コピーが利用できません');await api.writeText(output.value);document.getElementById('copyStatus').textContent='本文をコピーしました。noteに貼り付けて編集できます。';}catch{output.focus();output.select();document.getElementById('copyStatus').textContent='自動コピーが利用できません。選択した本文を手動でコピーしてください。';}}
 for(const input of document.querySelectorAll('.memo-input,.watch-note'))input.addEventListener('input',edited);
 save.addEventListener('click',saveMemo);copy.addEventListener('click',copyText);document.getElementById('selectArticle').addEventListener('click',()=>{output.focus();output.select();});
 document.getElementById('draftStatus').textContent=loadedSaved?'保存済みメモを表示中':'回顧メモは未保存です。';const ready=load();return{ready,saveMemo,edited,copyText,refreshAutoReview,applyAuto};
}
export function initWatchNotes({document,storage}){
 const node=document.getElementById('watchNotes');if(!node)return;try{if(storage===undefined)storage=globalThis.localStorage;const target=JSON.parse(document.getElementById('comparisonTarget').textContent),watch=upcomingWatch(parseMemoStore(storage?.getItem(MEMO_KEY)),target);node.textContent=watch.length?'次走注目メモ（馬名一致・手入力。指数への反映なし）\n'+watch.map(w=>w.horseName+' / '+w.sourceDate+'：'+w.note).join('\n'):'次走注目メモ：このブラウザに、対象日より前に保存した該当馬のメモはありません。';}catch{node.textContent='次走注目メモを読み込めません。DBの仮評価は利用できます。';}
}
