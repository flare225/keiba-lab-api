import {buildMarkComparison} from './mark-comparison-core-v3.41.0.js';

export function initComparison({document,storage=globalThis.localStorage,fetcher=globalThis.fetch,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 const target=JSON.parse(document.getElementById('comparisonTarget').textContent);
 const form=document.getElementById('previewForm'),status=document.getElementById('status'),results=document.getElementById('results'),button=document.getElementById('compareButton'),track=document.getElementById('trackScenario'),localNote=document.getElementById('localMarkNote');
 const selects=[...form.querySelectorAll('.mark-select')];
 const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const value=(v,suffix='')=>v==null?'未取得':esc(v)+suffix;
 const key='keiba-labo:initial-marks:v1:'+JSON.stringify([target.date,target.venue,target.raceNo,target.snapshotId,target.names]);
 const selected=()=>selects.filter(s=>s.value).map(s=>({horseName:s.dataset.horse,mark:s.value}));
 const cache=new Map(),pending=new Map();let sequence=0,timer=null,queue=Promise.resolve();
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved){for(const s of selects){const m=saved.marks?.find(m=>m.horseName===s.dataset.horse);if(m&&['◎','○','▲','△','☆','注','消'].includes(m.mark))s.value=m.mark;}if(['','良','稍重','重','不良'].includes(saved.track))track.value=saved.track;localNote.textContent='このブラウザに残した初期印を復元しました。DBへの印保存ではありません。';}}catch{localNote.textContent='このブラウザでの初期印の保存は利用できません。比較は利用できます。';}
 function save(){try{storage?.setItem(key,JSON.stringify({marks:selected(),track:track.value,updatedAt:now()}));localNote.textContent='初期印はこのブラウザ内に保存。DBの印・正式予想への保存は行いません。';}catch{localNote.textContent='このブラウザでの初期印の保存は利用できません。比較は利用できます。';}}
 function render(data,marks){
  const comparison=buildMarkComparison(data,marks);
  document.getElementById('comparisonSummary').innerHTML='<b>印とDBの見方が近い '+comparison.summary.aligned+'頭</b> · 別の見方も確認 '+comparison.summary.review+'頭 · 参考・保留 '+comparison.summary.held+'頭';
  document.getElementById('baselineNote').textContent='全'+comparison.runnerPool+'頭中、仮評価できる馬は'+comparison.scoredRunners+'頭。馬場：'+(comparison.trackAssumption||'未確定')+'。'+comparison.scoreMeaning;
  const previous=cache.get('previous');
  results.innerHTML=comparison.rows.map(r=>{
   const h=r.history,old=previous?.rows.find(x=>x.horseName===r.horseName),change=old&&previous.track!==track.value&&old.score!=null&&r.score!=null?'<p class="meta">前の馬場想定 '+esc(previous.track||'未確定')+'：'+value(old.score)+' → 今回：'+value(r.score)+'</p>':'';
   const rank=r.referenceRank==null?'順位は保留':(comparison.scoredRunners<comparison.runnerPool?'評価できた'+comparison.scoredRunners+'頭内 ':'全'+comparison.runnerPool+'頭内 ')+r.referenceRank+'位'+(r.tiedCount>1?'（同点'+r.tiedCount+'頭）':'');
   const p=r.positionEvidence,position='<h3>過去の位置取り</h3><p>'+esc(p.label)+' · 通過…1348 tokens truncated…ntById('baselineNote').textContent='';status.textContent='初期印を付けると、DBの仮評価が自動で表示されます。';button.disabled=false;return;}
  status.textContent='全馬の過去DBから仮評価を確認しています…';results.innerHTML='';document.getElementById('comparisonSummary').textContent='';document.getElementById('allRunnerTable').textContent='';document.getElementById('baselineNote').textContent='';button.disabled=true;
  try{const data=await dataFor(trackKey,force);if(id!==sequence)return;render(data,marks);status.textContent='初期印 '+marks.length+'頭を比較しました。'+(cache.get(trackKey)?'取得済みのDB評価を使い、印を変更しても同じ履歴を再取得しません。':'');}
  catch(e){if(id===sequence)status.textContent='仮比較を表示できませんでした：'+e.message;}
  finally{if(id===sequence)button.disabled=false;}
 }
 function changed(){++sequence;clearTimer(timer);results.innerHTML='';document.getElementById('comparisonSummary').textContent='';document.getElementById('allRunnerTable').textContent='';document.getElementById('baselineNote').textContent='';status.textContent='初期印の変更を反映しています…';save();timer=setTimer(()=>compare(),450);}
 form.addEventListener('change',changed);form.addEventListener('submit',e=>{e.preventDefault();compare(true);});
 if(selected().length)compare();return{compare,changed};
}
