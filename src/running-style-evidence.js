export const POSITION_POLICY='prior-corner-position-v1';
export function assessPositionHistory(history,race){
 const seen=new Set(),records=[];
 for(const r of history?.available?history.recent||[]:[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||r.date>=race.date||r.surface!==race.surface||!Number.isFinite(r.distance)||Math.abs(r.distance-race.distance)>400||!Number.isInteger(r.fieldSize)||r.fieldSize<2||r.fieldSize>40||r.finishStatus&&r.finishStatus!=='finished')continue;
  const stamp=Date.parse(r.date+'T00:00:00Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==r.date||!Number.isInteger(r.finish)||r.finish<1||r.finish>r.fieldSize)continue;
  const text=String(r.cornerPositions||'').trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-65248));
  if(!/^\d{1,2}(?:\s*[-－–→/]\s*\d{1,2}){1,3}$/.test(text))continue;
  const positions=text.match(/\d+/g).map(Number);if(positions.some(n=>n<1||n>r.fieldSize))continue;
  const key=r.date+'|'+r.venue;if(seen.has(key))continue;seen.add(key);
  const first=positions[0],fraction=(first-1)/(r.fieldSize-1),category=fraction<=1/3?'front':fraction<2/3?'middle':'back';
  records.push({date:r.date,venue:r.venue,raceName:r.raceName,surface:r.surface,distance:r.distance,fieldSize:r.fieldSize,positions,firstRecordedPosition:first,lastRecordedPosition:positions.at(-1),category,finish:r.finish??null,last3f:r.last3f??null,sourceUrl:r.detailSourceUrl||r.sourceUrl||null,sourceKind:r.dbSource||'unknown'});
 }
 const counts=Object.fromEntries(['front','middle','back'].map(k=>[k,records.filter(r=>r.category===k).length]));
 const lead=records.filter(r=>r.firstRecordedPosition===1).length,available=records.length>=3;
 const dominant=Object.keys(counts).find(k=>counts[k]/records.length>=2/3)||'mixed';
 const style=!available?'unknown':lead/records.length>=2/3?'lead':dominant;
 const labels={unknown:'未判定',lead:'先頭通過が多い',front:'前方傾向',middle:'中団傾向',back:'後方傾向',mixed:'位置取りは混在'};
 return {policy:POSITION_POLICY,available,style,label:labels[style],validPositionRows:records.length,consideredRows:history?.recent?.length||0,counts,firstRecordedLeads:lead,records,missingReason:available?null:'同じ芝・ダート、距離差400m以内の有効な通過順が3走未満',guardrails:{targetDateExcluded:true,firstRecordedCornerNotNecessarilyFirstCorner:true,closingAbilityNotInferredFromRawLast3f:true,scoreWeightApplied:false,validatedPrediction:false}};
}
export function buildRaceShapeEvidence(rows){
 const covered=rows.filter(r=>r.assessment?.runningStyle?.available),front=covered.filter(r=>['lead','front'].includes(r.assessment.runningStyle.style));
 return {policy:POSITION_POLICY,runnerPool:rows.length,coveredRunners:covered.length,coverageComplete:covered.length===rows.length&&rows.length>0,frontCandidates:front.map(r=>({horseName:r.horseName,horseNo:r.horseNo??null,label:r.assessment.runningStyle.label})),unknownHorses:rows.filter(r=>!r.assessment?.runningStyle?.available).map(r=>r.horseName),paceForecast:null,paceReason:'区間ラップ・当日の位置取り条件が未取得のため、実際のペースや有利不利は未判定',guardrails:{humanMarksUsed:false,targetResultUsed:false,scoreWeightApplied:false,automaticPromotion:false}};
}
