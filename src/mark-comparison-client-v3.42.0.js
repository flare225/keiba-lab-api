import {buildMarkComparison} from './mark-comparison-core-v3.41.0.js';
import {REVIEW_PHASES,reviewRaceKey,reviewPhaseReason,makeCheckpoint,readCheckpoints,appendCheckpoint,compareCheckpoints} from './comparison-review-v3.42.0.js';

export function initComparison({document,storage,fetcher=globalThis.fetch,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 try{if(storage===undefined)storage=globalThis.localStorage;}catch{storage=null;}
 const target=JSON.parse(document.getElementById('comparisonTarget').textContent);
 const form=document.getElementById('previewForm'),status=document.getElementById('status'),results=document.getElementById('results'),button=document.getElementById('compareButton'),track=document.getElementById('trackScenario'),localNote=document.getElementById('localMarkNote');
 const selects=[...form.querySelectorAll('.mark-select')];
 const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const value=(v,suffix='')=>v==null?'未取得':esc(v)+suffix;
 const legacyKey='keiba-labo:initial-marks:v1:'+JSON.stringify([target.date,target.venue,target.raceNo,target.snapshotId,target.names]);
 const key='keiba-labo:initial-marks:v2:'+reviewRaceKey(target);
 const selected=()=>selects.filter(s=>s.value).map(s=>({horseName:s.dataset.horse,mark:s.value}));
 const cache=new Map(),pending=new Map();let sequence=0,timer=null,queue=Promise.resolve();

 const historyKey='keiba-labo:comparison-history:v1:'+reviewRaceKey(target),baseline=document.getElementById('reviewBaseline'),phase=document.getElementById('reviewPhase'),recordStatus=document.getElementById('recordStatus');
 let checkpoints=[],historyReadable=true,readyData=null,readyMarks=[];
 try{checkpoints=readCheckpoints(storage?.getItem(historyKey),reviewRaceKey(target));}catch(e){historyReadable=false;recordStatus.textContent=e.message;}
 function invalidateReview(){readyData=null;readyMarks=[];document.getElementById('recordComparison').disabled=true;document.getElementById('reviewDelta').textContent='比較結果の表示後に、記録との差を確認できます。';}
 const when=v=>new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 function updateReview(){
  const meta=readyData?.reviewMeta||target.reviewMeta||{};
  for(const option of phase.options||[])option.disabled=Boolean(reviewPhaseReason(option.value,meta,target.date,now()));
  if(reviewPhaseReason(phase.value||'initial',meta,target.date,now()))phase.value='initial';
  const chosen=baseline.value;
  baseline.innerHTML='<option value="">記録を選んで比較</option>'+checkpoints.map(s=>'<option value="'+esc(s.id)+'">'+esc(when(s.capturedAt)+' '+REVIEW_PHASES[s.phase]+' / '+(s.track||'馬場未確定'))+'</option>').join('');
  baseline.value=checkpoints.some(s=>s.id===chosen)?chosen:(checkpoints[0]?.id||'');
  document.getElementById('reviewCount').textContent='記録 '+checkpoints.length+'件（このブラウザ内・最大20件）';
  document.getElementById('recordComparison').disabled=!readyData||!historyReadable||!storage;
  const selectedCheckpoint=checkpoints.find(s=>s.id===baseline.value),delta=document.getElementById('reviewDelta');
  if(!readyData){delta.textContent='比較結果の表示後に、記録との差を確認できます。';return;}
  if(!selectedCheckpoint){delta.textContent='今の比較を記録すると、次の見直しで変化を確認できます。';return;}
  const current=makeCheckpoint(target,readyData,readyMarks,'initial',now()),diff=compareCheckpoints(selectedCheckpoint,current),shown=diff.changes.filter(r=>r.changed||r.markBefore||r.markAfter);
  const pair=(a,b,suffix='')=>value(a,suffix)+' → '+value(b,suffix);
  delta.innerHTML='<p><b>'+esc(when(selectedCheckpoint.capturedAt)+' '+REVIEW_PHASES[selectedCheckpoint.phase])+'</b>との比較。馬場 '+esc(selectedCheckpoint.track||'未確定')+' → '+esc(current.track||'未確定')+'</p><p class="meta">'+esc(diff.notice)+'</p><div class="table-scroll"><table><thead><tr><th>馬名</th><th>一覧</th><th>印</th><th>参考指数</th><th>参考順位</th><th>有効着順</th><th>枠番</th></tr></thead><tbody>'+shown.map(r=>'<tr><th>'+esc(r.horseName)+'</th><td>'+esc(r.participation)+'</td><td>'+pair(r.markBefore,r.markAfter)+'</td><td>'+pair(r.before?.score,r.after?.score)+(r.scoreDelta==null?'':'（'+(r.scoreDelta>0?'+':'')+r.scoreDelta+'）')+'</td><td>'+(r.rankComparable?pair(r.before?.referenceRank,r.after?.referenceRank,'位'):'順位差は保留')+'</td><td>'+pair(r.before?.validFinishRows,r.after?.validFinishRows,'走')+'</td><td>'+pair(r.before?.frameNo,r.after?.frameNo,'枠')+'</td></tr>').join('')+'</tbody></table></div><p class="meta">'+esc(diff.frameScoreNotice)+(diff.sourceChanged?' 掲載元・出馬表の保存情報も変わっています。':'')+' 指数の変化は馬場想定や履歴補完も含むため、枠順だけの影響とは判断しません。</p>'+(selectedCheckpoint.retrospective?'<p class="warning">選択した記録は対象レースの開催日後に作成した見直しです。</p>':'');
 }
 function recordCheckpoint(){
  if(!readyData){recordStatus.textContent='比較結果を表示してから記録してください。';return;}
  if(!historyReadable||!storage){recordStatus.textContent='保存済みの記録を保護するため、追加を保留しています。比較は利用できます。';return;}
  try{const snapshot=makeCheckpoint(target,readyData,readyMarks,phase.value||'initial',now()),next=appendCheckpoint(checkpoints,snapshot);storage.setItem(historyKey,JSON.stringify(next));const added=next.length!==checkpoints.length||next.at(-1)?.id!==checkpoints.at(-1)?.id;checkpoints=next;recordStatus.textContent=added?'比較を記録しました。印・馬場想定・参考指数と時刻をこのブラウザ内に保存しています。':'同じ比較は記録済みです。';updateReview();}
  catch(e){recordStatus.textContent='比較を記録できませんでした：'+e.message;}
 }
 document.getElementById('recordComparison').addEventListener('click',recordCheckpoint);baseline.addEventListener('change',updateReview);phase.addEventListener('change',updateReview);
 try{const saved=JSON.parse(storage?.getItem(key)||storage?.getItem(legacyKey)||'null');if(saved){for(const s of selects){const m=saved.marks?.find(m=>m.horseName===s.dataset.horse);if(m&&['◎','○','▲','△','☆','注','消'].includes(m.mark))s.value=m.mark;}if(['','良','稍重','重','不良'].includes(saved.track))track.value=saved.track;localNote.textContent='このブラウザに残した初期印を復元しました。DBへの印保存ではありません。';}}catch{localNote.textContent='このブラウザでの初期印の保存は利用できません。比較は利用できます。';}
 function save(){try{if(!storage)throw Error('保存 unavailable');storage.setItem(key,JSON.stringify({marks:selected(),track:track.value,updatedAt:now()}));localNote.textContent='初期印はこのブラウザ内に保存。DBの印・正式予想への保存は行いません。';}catch{localNote.textContent='このブラウザでの初期印の保存は利用できません。比較は利用できます。';}}
 function render(data,marks){
  const comparison=buildMarkComparison(data,marks);
  const roster=new Map((data.reviewMeta?.roster||target.reviewMeta?.roster||[]).map(r=>[r.horseName,r]));
  const frameText=name=>{const r=roster.get(name);return r?.frameNo?'<span class="frame-badge frame-'+r.frameNo+'">'+r.frameNo+'枠</span> '+r.horseNo+'番':r?.horseNo?r.horseNo+'番・枠の照合待ち':'枠・馬番未確定';};
  document.getElementById('comparisonSummary').innerHTML='<b>印とDBの見方が近い '+comparison.summary.aligned+'頭</b> · 別の見方も確認 '+comparison.summary.review+'頭 · 参考・保留 '+comparison.summary.held+'頭';
  document.getElementById('baselineNote').textContent='全'+comparison.runnerPool+'頭中、仮評価できる馬は'+comparison.scoredRunners+'頭。馬場：'+(comparison.trackAssumption||'未確定')+'。'+comparison.scoreMeaning;
  const previous=cache.get('previous');
  results.innerHTML=comparison.rows.map(r=>{
   const h=r.history,old=previous?.rows.find(x=>x.horseName===r.horseName),change=old&&previous.track!==track.value&&old.score!=null&&r.score!=null?'<p class="meta">前の馬場想定 '+esc(previous.track||'未確定')+'：'+value(old.score)+' → 今回：'+value(r.score)+'</p>':'';
   const rank=r.referenceRank==null?'順位は保留':(comparison.scoredRunners<comparison.runnerPool?'評価できた'+comparison.scoredRunners+'頭内 ':'全'+comparison.runnerPool+'頭内 ')+r.referenceRank+'位'+(r.tiedCount>1?'（同点'+r.tiedCount+'頭）':'');
   return '<article class="card"><div class="horsehead"><b>'+esc(r.humanMark)+' '+esc(r.horseName)+'</b><span class="meta">'+frameText(r.horseName)+'</span></div><div class="status"><strong>'+esc(r.label)+'</strong><p>'+esc(r.explanation)+'</p><b>参考指数 '+value(r.score,' / 100')+'</b> · '+esc(rank)+change+'</div><h3>DBが見ている材料</h3><div class="reason-grid">'+r.reasons.map(x=>'<div class="metric"><span>'+esc(x.label)+'</span><b>'+value(x.score)+'</b><small>'+(x.rows==null?'走数は未取得':x.rows+'走')+'</small></div>').join('')+'</div><h3>まだ足りない情報</h3><ul class="gaps">'+r.gaps.map(g=>'<li>'+esc(g)+'</li>').join('')+'</ul><details><summary>根拠の過去走 '+(h?.recent?.length||0)+'走を見る</summary>'+(h?.recent||[]).map(x=>'<div class="race"><b>'+esc(x.date)+' '+esc(x.venue)+' '+esc(x.raceName)+'</b> · '+value(x.finish,'着')+'<small>'+value(x.surface)+' '+value(x.distance,'m')+' / 通過 '+value(x.cornerPositions)+' / 上がり3F '+value(x.last3f,'秒')+' / '+esc(x.dbSource?.includes('netkeiba')?'netkeiba補完・JRA未照合':'保存済みDB')+'</small></div>').join('')+'</details></article>';
  }).join('');
  const marksByName=new Map(marks.map(m=>[m.horseName,m.mark]));
  document.getElementById('allRunnerTable').innerHTML='<h2>全馬の参考評価</h2><p class="meta">印を付けていない馬も同じ条件で集計。同点に馬番で差を付けません。</p><div class="table-scroll"><table><thead><tr><th>初期印</th><th>馬名</th><th>枠・馬番</th><th>参考順位</th><th>参考指数</th><th>有効着順</th></tr></thead><tbody>'+data.assessment.allRunners.map(r=>'<tr><td>'+esc(marksByName.get(r.horseName)||'—')+'</td><th>'+esc(r.horseName)+'</th><td>'+frameText(r.horseName)+'</td><td>'+value(r.referenceRank,'位')+(r.tiedCount>1?'（同点）':'')+'</td><td>'+value(r.assessment.evidenceScore)+'</td><td>'+r.assessment.validFinishRows+'走</td></tr>').join('')+'</tbody></table></div>';
  readyData=data;readyMarks=marks.map(m=>({...m}));updateReview();
  cache.set('previous',{track:track.value,rows:comparison.rows.map(r=>({horseName:r.horseName,score:r.score}))});
 }
 async function dataFor(trackKey,force){
  const old=cache.get(trackKey);if(!force&&old&&now()-old.at<60000)return old.data;
  if(pending.has(trackKey))return pending.get(trackKey);
  const work=queue.catch(()=>{}).then(async()=>{
   const response=await fetcher('/v1/lab/mark-comparison',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:target.date,venue:target.venue,raceNo:target.raceNo,phase:'initial',sourceSnapshotId:target.snapshotId,track:trackKey||null,marks:target.names.map(horseName=>({horseName,mark:'注'}))})});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'DBの仮評価を取得できませんでした。');cache.set(trackKey,{at:now(),data});return data;
  });pending.set(trackKey,work);queue=work;try{return await work;}finally{pending.delete(trackKey);}
 }
 async function compare(force=false){
  invalidateReview();clearTimer(timer);const id=++sequence,marks=selected(),trackKey=track.value;save();
  if(!marks.length){results.innerHTML='';document.getElementById('comparisonSummary').textContent='';document.getElementById('allRunnerTable').textContent='';document.getElementById('baselineNote').textContent='';status.textContent='初期印を付けると、DBの仮評価が自動で表示されます。';button.disabled=false;return;}
  status.textContent='全馬の過去DBから仮評価を確認しています…';results.innerHTML='';document.getElementById('comparisonSummary').textContent='';document.getElementById('allRunnerTable').textContent='';document.getElementById('baselineNote').textContent='';button.disabled=true;
  try{const data=await dataFor(trackKey,force);if(id!==sequence)return;render(data,marks);status.textContent='初期印 '+marks.length+'頭を比較しました。'+(cache.get(trackKey)?'取得済みのDB評価を使い、印を変更しても同じ履歴を再取得しません。':'');}
  catch(e){if(id===sequence)status.textContent='仮比較を表示できませんでした：'+e.message;}
  finally{if(id===sequence)button.disabled=false;}
 }
 function changed(){invalidateReview();++sequence;clearTimer(timer);results.innerHTML='';document.getElementById('comparisonSummary').textContent='';document.getElementById('allRunnerTable').textContent='';document.getElementById('baselineNote').textContent='';status.textContent='初期印の変更を反映しています…';save();timer=setTimer(()=>compare(),450);}
 form.addEventListener('change',changed);form.addEventListener('submit',e=>{e.preventDefault();compare(true);});
 updateReview();if(selected().length)compare();return{compare,changed,recordCheckpoint};
}
