const RULES={'◎':3,'○':4,'▲':5,'△':8,'☆':8,'注':8,'消':4};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const metric=(label,score,rows)=>({label,score:finite(score)?score:null,rows:Number.isInteger(rows)&&rows>=0?rows:null});

export function buildMarkComparison(data,marks=data.audit?.marked||[]){
 const a=data.assessment;if(!a||!Array.isArray(a.allRunners))throw Error('全馬の参考評価を確認できません。');
 const history=new Map((data.audit?.historySidecar||[]).map(h=>[h.horseName,h]));
 const all=new Map(a.allRunners.map(r=>[r.horseName,r]));
 const seen=new Set();
 const rows=marks.map(mark=>{
  const r=all.get(mark.horseName);if(!r||!(mark.mark in RULES)||seen.has(mark.horseName))throw Error('馬名・初期印・重複を確認してください。');seen.add(mark.horseName);
  const s=r.assessment,h=history.get(r.horseName),recent=h?.recent||[],d=s.detail||{},c=s.components||{};
  const reasons=[metric('過去の着順',c.basicAbilityResults,d.ability?.validFinishRows),metric('直近の成績',c.recentPerformanceDevelopment,d.recent?.rows),metric('コース・距離',c.courseDistanceFit,d.course?.exactDistance?.validFinishRows),metric('想定馬場',c.ground,d.ground?.validFinishRows)];
  const gaps=[];
  if(!s.available)gaps.push('有効な履歴を確認できず、仮評価を保留しています。');
  if(s.validFinishRows<3)gaps.push('有効な着順は'+s.validFinishRows+'走。履歴が少ないため参考量が限られます。');
  if(!s.sameCourseDistanceStarts)gaps.push('同じ競馬場・馬場種別・距離の履歴がありません。');
  if(!a.trackAssumption)gaps.push('当日の馬場は未確定。馬場評価を保留しています。');
  else if(!finite(c.ground))gaps.push('想定した馬場に一致する有効な履歴がありません。');
  if(recent.length){const last=recent.filter(x=>finite(x.last3f)&&x.last3f>0).length,corners=recent.filter(x=>typeof x.cornerPositions==='string'&&x.cornerPositions.trim()).length;if(last<recent.length)gaps.push('上がり3F：'+last+'/'+recent.length+'走を収録。');if(corners<recent.length)gaps.push('通過順：'+corners+'/'+recent.length+'走を収録。');}
  for(const w of h?.warnings||[])if(w==='conflicting-history-identity')gaps.push('保存データの照合に不一致があり、比較を保留しています。');
  gaps.push('展開・位置取りへの適合と追い切りは、この仮指数には未反映です。');
  let state='aligned',label='印とDBの見方が近い',explanation='参考順位と初期印を比較しています。';
  const limit=Math.min(RULES[mark.mark],a.runnerPool),rank=r.referenceRank,ties=Math.max(1,r.tiedCount||1);
  if(!s.available||!finite(rank)){state='unavailable';label='履歴不足で比較を保留';explanation='履歴未収録と未出走は、このデータだけでは区別できません。';}
  else if(s.validFinishRows<3){state='thin-history';label='少ない履歴での参考比較';explanation='印との一致・不一致はまだ判断しません。';}
  else if(a.scoredRunners<a.runnerPool){state='incomplete-pool';label='全馬の履歴補完待ち';explanation='評価できた'+a.scoredRunners+'頭内の参考順位です。全馬そろってから比較します。';}
  else if(rank<=limit&&rank+ties-1>limit){state='tie-boundary';label='同点グループ内の比較';explanation='同点の馬に差を付けず、初期印との比較を保留しています。';}
  else if(mark.mark==='消'?rank<=limit:rank>limit){state='review';label='別の見方も確認';explanation=mark.mark==='消'?'DBでは参考上位に入ります。印を見直す材料として確認できます。':'DBの参考順位と初期印に差があります。根拠と不足項目を確認できます。';}
  return{horseName:r.horseName,horseNo:r.horseNo??mark.horseNo??null,humanMark:mark.mark,score:s.evidenceScore,referenceRank:rank,tiedCount:ties,state,label,explanation,reasons,gaps:[...new Set(gaps)],validFinishRows:s.validFinishRows,coveragePct:s.modelCoveragePct,history:h||null};
 });
 const chosen=new Set(marks.map(m=>m.horseName));
 return{rows,unmarkedCandidates:a.allRunners.filter(r=>r.assessment.available&&!chosen.has(r.horseName)).sort((x,y)=>x.referenceRank-y.referenceRank).filter(r=>r.referenceRank<=3).map(r=>({horseName:r.horseName,referenceRank:r.referenceRank,tiedCount:r.tiedCount,score:r.assessment.evidenceScore,validFinishRows:r.assessment.validFinishRows})),runnerPool:a.runnerPool,scoredRunners:a.scoredRunners,trackAssumption:a.trackAssumption,summary:{aligned:rows.filter(r=>r.state==='aligned').length,review:rows.filter(r=>r.state==='review').length,held:rows.filter(r=>!['aligned','review'].includes(r.state)).length},guardrails:{humanMarksUsedInScore:false,targetResultUsed:false,noForcedTieBreak:true,accuracyImprovementValidated:false},scoreMeaning:'過去走の参考指数。的中確率ではありません。'};
}
