const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clean=v=>String(v??'').trim();
export function normalizeFinishStatus(value){return({'scratched':'取消','excluded':'除外','did-not-finish':'中止','disqualified':'失格','finished':'完走'})[value]||value||null;}
export function normalizeHistoryStatuses(history){return{...history,runners:(history.runners||[]).map(r=>({...r,finishStatus:normalizeFinishStatus(r.finishStatus)}))};}
export function parseIndividualCorners(text,pool){
 const s=clean(text);if(!s||!/^\d{1,2}(?:[\s\-－−→]+\d{1,2}){0,3}$/.test(s))return null;
 const values=s.split(/[\s\-－−→]+/).map(Number);return values.every(v=>Number.isInteger(v)&&v>=1&&v<=pool)?values:null;
}
export function reviewMarkBasis(history){
 const rows=new Map((history.runners||[]).map(r=>[r.horseName,r]));
 const valid=marks=>Array.isArray(marks)&&marks.length>0&&marks.every(m=>rows.has(m.horseName)&&['◎','○','▲','△','☆','注','消'].includes(m.mark)&&(m.horseNo==null||m.horseNo===rows.get(m.horseName).horseNo));
 const human=(history.markRevisions||[]).filter(r=>Number.isFinite(Date.parse(r.createdAt))&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.createdAt))<history.race?.date&&valid(r.marked)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
 if(human)return{kind:'human-pre-day-db',label:'開催日前にDB保存した自分の印',marks:human.marked};
 const p=history.laboPrediction;if(p?.available&&p.locked&&p.hashVerified&&valid(p.top5))return{kind:'verified-labo-lock',label:'確認済みの事前LABO LOCK',marks:p.top5};
 return{kind:'none',label:'確認できる事前印なし',marks:[]};
}
export function buildAutomaticReview(history,{focusHorseName=null}={}){
 history=normalizeHistoryStatuses(history);
 const rows=history.runners||[],n=Number(history.race?.runnerCount),basis=reviewMarkBasis(history);
 if(!history.ok||!Number.isInteger(n)||n<1||n>18||!rows.length||rows.length>n||new Set(rows.map(r=>r.horseName)).size!==rows.length||new Set(rows.map(r=>r.horseNo)).size!==rows.length||rows.some(r=>!r.horseName||!Number.isInteger(r.horseNo)||r.horseNo<1||r.horseNo>n))return{available:false,reason:'全馬の保存済み結果の対応を確認できません。',fields:{},facts:[]};
 if(focusHorseName&&!rows.some(r=>r.horseName===focusHorseName))throw Error('回顧対象の馬を確認してください。');
 const isFinisher=r=>Number.isInteger(r.finishPosition)&&r.finishPosition>=1&&r.finishPosition<=n&&!/取消|除外|中止|失格|取止/.test(r.finishStatus||'');
 const finishers=rows.filter(isFinisher),timed=finishers.filter(r=>finite(r.last3f)&&r.last3f>0);
 if(!finishers.length)return{available:false,reason:'着順のある完走馬の結果が未取得です。手入力の回顧メモは利用できます。',fields:{},facts:[]};
 const full=history.result?.complete===true&&rows.length===n&&rows.every(r=>isFinisher(r)||/取消|除外|中止|失格|取止/.test(r.finishStatus||''));
 const facts=rows.map(r=>{const corners=isFinisher(r)?parseIndividualCorners(r.cornerPositions,n):null,hasTime=isFinisher(r)&&finite(r.last3f)&&r.last3f>0;return{horseName:r.horseName,horseNo:r.horseNo,finishPosition:isFinisher(r)?r.finishPosition:null,finishStatus:r.finishStatus||null,last3f:hasTime?r.last3f:null,last3fRank:hasTime?1+timed.filter(x=>x.last3f<r.last3f).length:null,tiedCount:hasTime?timed.filter(x=>x.last3f===r.last3f).length:0,timedPool:timed.length,finisherPool:finishers.length,corners,lateDelta:corners?corners.at(-1)-r.finishPosition:null};});
 const describe=f=>{if(f.finishPosition==null)return`${f.horseName}：${f.finishStatus||'着順未取得'}。順位の移動や上がり順位は判断しません。`;let s=`${f.horseName}は${f.finishPosition}着。`;s+=f.corners?` 通過記録は${f.corners.join('→')}番手、末尾${f.corners.at(-1)}番手→${f.finishPosition}着（記録上${f.lateDelta>0?f.lateDelta+'つ前':f.lateDelta<0?Math.abs(f.lateDelta)+'つ後ろ':'同じ順位'}）。`:' 通過順は未取得、または個別順位として読めないため保留。';s+=f.last3fRank!=null?` 上がり3F ${f.last3f}秒、タイムを確認できた${f.timedPool}頭内${f.last3fRank}位${f.tiedCount>1?'（同タイム'+f.tiedCount+'頭）':''}。`:' 上がり3Fは未取得。';return s;};
 const chosen=focusHorseName||basis.marks.find(m=>m.mark==='◎')?.horseName||null,focus=facts.find(f=>f.horseName===chosen);
 const top=finishers.filter(r=>r.finishPosition<=3).sort((a,b)=>a.finishPosition-b.finishPosition).map(r=>r.finishPosition+'着 '+r.horseName);
 const fastest=facts.filter(f=>f.last3fRank===1).map(f=>f.horseName+' '+f.last3f+'秒');
 const fields={overview:(full?'全'+n+'頭の保存済み結果を確認。':'結果は一部未取得。保存済みの範囲で整理。')+'\n'+(top.length?'保存済みの上位着順：'+top.join('／')+'。':'上位着順は未取得。')+'\n'+(fastest.length?'上がり3Fの最小値（確認できた'+timed.length+'頭内）：'+fastest.join('／')+'。':'上がり3Fは未取得。'),axis:focus?(focusHorseName?'この画面で選んだ回顧対象。事前の軸指定とは別です。\n':basis.label+'の◎。\n')+describe(focus):'確認できる事前の◎がなく、軸馬を自動では決めません。回顧する馬を選ぶか、手入力で振り返ってください。',track:'結果表だけでは当日の馬場状態・内外の伸びを確認できません。公式発表・映像で確認してください。',position:(focus?[describe(focus)]:facts.filter(f=>f.finishPosition!=null&&f.finishPosition<=3).map(describe)).join('\n')+'\n通過記録と着順の差を整理したものです。抜いた場所・進路・不利の有無は映像で確認してください。',gap:basis.marks.length?basis.label+'と着順：\n'+basis.marks.map(m=>{const f=facts.find(x=>x.horseName===m.horseName);return m.mark+' '+m.horseName+' → '+(f?.finishPosition!=null?f.finishPosition+'着':f?.finishStatus||'結果未取得');}).join('\n')+'\n位置取り・進路・馬場適性・仕掛けのタイミングを映像で確認。結果表だけで敗因は決めません。':'比較できる事前印がなく、予想とのズレは判定できません。見直し記録を事前印として作り直しません。\n位置取り・進路・馬場適性は映像で確認してください。'};
 return{available:true,version:'result-facts-review-v1',fields,facts,focusHorseName:chosen,markBasis:basis.kind,coverage:{resultComplete:full,rosterRows:rows.length,runnerPool:n,finishers:finishers.length,last3fRows:timed.length,individualCornerRows:facts.filter(f=>f.corners).length},warnings:[...(!full?['結果は一部未取得。全馬の傾向とは判断しません。']:[]),...(timed.length<finishers.length?['上がり順位は取得できた馬の中での比較です。']:[]),'結果表の事実整理です。敗因の確定・映像確認・学習は行っていません。'],guardrails:{noExternalFetch:true,noScoreMutation:true,noAutomaticTraining:true,noCauseAssertion:true,noPreRaceMarkReconstruction:true}};
}
export function applyReviewFields(current,proposal,{field=null}={}){
 if(!proposal.available)throw Error('回顧案がまだ作成されていません。');const fields={...current},changed=[],skipped=[];
 for(const key of field?[field]:Object.keys(proposal.fields)){if(!Object.hasOwn(proposal.fields,key))throw Error('反映する項目を確認してください。');const old=clean(fields[key]);if(!field&&old){skipped.push(key);continue;}const value=old?old+'\n\n'+proposal.fields[key]:proposal.fields[key];if(value.length>2000){skipped.push(key);continue;}fields[key]=value;changed.push(key);}
 return{fields,changed,skipped};
}
