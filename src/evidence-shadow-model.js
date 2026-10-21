// Explicit, unvalidated policy candidate. Never used by production capture/LOCK.
import {assessPositionHistory} from './running-style-evidence.js';
export const SHADOW_POLICY={model:'course-position-shadow-v1',courseWeight:0.2,coursePriorStarts:3,maxPacePoints:2,styleFullConfidenceStarts:5,productionEnabled:false,accuracyValidated:false};
const round=x=>Math.round(x*100)/100;
const valid=r=>Number.isInteger(r.finish)&&Number.isInteger(r.fieldSize)&&r.fieldSize>=2&&r.finish>=1&&r.finish<=r.fieldSize;
const value=r=>100*(1-(r.finish-1)/(r.fieldSize-1));
export function evidenceShadowModel(snapshot){
 const race=snapshot.race;if(!race?.date)throw Error('Target date required');
 const horses=snapshot.runners.map(r=>{const h=snapshot.histories.find(h=>h.horseName===r.horseName);const rows=(h?.available?h.recent:[]).filter(x=>x.date<race.date&&valid(x)).sort((a,b)=>b.date.localeCompare(a.date));
  const used=rows.slice(0,3),weights=[3,2,1],den=used.reduce((n,x,i)=>n+weights[i],0),recent=den?used.reduce((n,x,i)=>n+value(x)*weights[i],0)/den:null;
  const course=rows.filter(x=>x.venue===race.venue&&x.surface===race.surface&&x.distance===race.distance);const courseMean=course.length?course.reduce((n,x)=>n+value(x),0)/course.length:null;
  const shrunk=recent==null?null:courseMean==null?recent:(course.length*courseMean+SHADOW_POLICY.coursePriorStarts*recent)/(course.length+SHADOW_POLICY.coursePriorStarts);
  const positions=assessPositionHistory(h,race);const fraction=positions.records.length?positions.records.reduce((n,x)=>n+(x.firstRecordedPosition-1)/(x.fieldSize-1),0)/positions.records.length:null;
  const style=positions.available?(fraction<=0.15?'逃げ':fraction<=0.4?'先行':fraction<=0.7?'差し':'追込'):null;
  return{horseName:r.horseName,rank:null,score:null,recent,courseMean,shrunk,style,confidence:positions.available?Math.min(positions.validPositionRows/SHADOW_POLICY.styleFullConfidenceStarts,1):0,positionEvidence:positions,primaryInput:used,courseInput:course,heldReason:recent==null?(h?.warnings||['missing-history']):null,missing:['着差','相手のクラス・能力','レース区間ラップ','当日の馬場・枠順'],contributions:{recent:recent==null?null:round(recent),course:recent==null?null:round(SHADOW_POLICY.courseWeight*(shrunk-recent)),pace:0}};
 });
 const complete=horses.length>0&&horses.every(h=>h.style),leaders=horses.filter(h=>h.style==='逃げ').length,forward=horses.filter(h=>['逃げ','先行'].includes(h.style)).length;
 const pace=complete?(leaders>=2||forward/horses.length>=0.4?'high-front-pressure':leaders===1&&forward/horses.length<=0.25?'low-front-pressure':'balanced'):null;
 for(const h of horses){if(h.recent==null)continue;const hypothesis=pace==='high-front-pressure'?(['差し','追込'].includes(h.style)?1:-1):pace==='low-front-pressure'?(['逃げ','先行'].includes(h.style)?1:-1):0;h.contributions.pace=round(hypothesis*SHADOW_POLICY.maxPacePoints*h.confidence);h.score=round(h.recent+h.contributions.course+h.contributions.pace);}
 for(const h of horses)if(h.score!=null)h.rank=1+horses.filter(x=>x.score!=null&&x.score>h.score).length;
 return{policy:SHADOW_POLICY,race,phase:'offline-shadow-only',pace:{proxy:pace,fullFieldStyleCoverage:complete,covered:horses.filter(h=>h.style).length,total:horses.length,leaders,forward,actualPaceSeconds:null,basis:'unvalidated style-composition hypothesis; not measured race pace',missingReason:complete?null:'全馬の条件一致した通過順3走以上が揃っていない'},horses,guardrails:{savedPredictionModified:false,formalLock:false,learningCandidate:false,automaticPromotion:false,humanMarksUsed:false,rawLast3fRanked:false}};
}
