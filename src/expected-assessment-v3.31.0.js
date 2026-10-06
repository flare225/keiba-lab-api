import {scoreRunner} from './expected-evidence-core-v3.31.0.js';
import {expectedRunnerPreview,validatePreview} from './expected-runner-preview-v3.30.0.js';
const CONDITIONS=['良','稍重','重','不良'];
const norm=v=>v==='稍'?'稍重':v;
export function assessExpectedHistory(history,race,track=null){
 if(track&&!CONDITIONS.includes(track))throw Error('想定馬場は良・稍重・重・不良から指定してください。');
 const rows=(history?.available?history.recent:[])?.filter(r=>r.date<race.date)||[];
 const normalized=rows.map(r=>({race_date:r.date,venue:r.venue,surface:r.surface,distance:r.distance,finish_position:r.finish,field_size:r.fieldSize,last3f:r.last3f,track_condition:norm(r.trackCondition)}));
 const score=scoreRunner(normalized,{surface:race.surface,distance:race.distance,venue:race.venue},track);
 const finishRows=normalized.filter(r=>Number.isInteger(r.finish_position)&&r.finish_position>0&&Number.isInteger(r.field_size)&&r.field_size>=r.finish_position&&r.field_size>=2);
 // The legacy heuristic confidence uses row count. Invalid finishes must not inflate depth.
 const depthPct=Math.min(finishRows.length/5,1)*100;
 const notes=[];
 if(!rows.length)notes.push('履歴未保存・照合保留のため評価できません。');
 else if(finishRows.length<3)notes.push('有効な着順履歴が'+finishRows.length+'走のため、参考評価です。');
 if(!score.detail.course.exactDistance.rows)notes.push('同じ芝・ダートと距離の履歴がありません。適性が低いとは断定しません。');
 if(!track)notes.push('当日の馬場は未入力のため、馬場評価を保留しています。');
 else if(!score.detail.ground.rows)notes.push('想定馬場に一致する履歴がなく、馬場評価を保留しています。');
 return{available:score.evidenceScore!==null,evidenceScore:score.evidenceScore,modelCoveragePct:score.modelCoveragePct,
  historyRows:rows.length,validFinishRows:finishRows.length,evidenceDepthPct:depthPct,
  evidenceStrength:finishRows.length===0?'unavailable':finishRows.length<3?'thin':finishRows.length<5?'limited':'more-history',
  components:score.components,detail:score.detail,notes,
  sameCourseDistanceStarts:normalized.filter(r=>r.surface===race.surface&&r.venue===race.venue&&r.distance===race.distance).length,
  provenance:rows.some(r=>r.dbSource?.includes('netkeiba'))?'includes-netkeiba-unverified':'stored-db',
  scoreMeaning:'existing LABO v1.5 descriptive evidence index; not a win probability or validated final forecast',
  rawLast3fUsedForRanking:false};
}
export function rankAssessment(rows){
 const scored=rows.filter(r=>r.assessment.available).sort((a,b)=>b.assessment.evidenceScore-a.assessment.evidenceScore);
 for(const row of rows){row.referenceRank=row.assessment.available?1+scored.filter(x=>x.assessment.evidenceScore>row.assessment.evidenceScore).length:null;row.tiedCount=row.assessment.available?scored.filter(x=>x.assessment.evidenceScore===row.assessment.evidenceScore).length:0}
 return rows;
}
export async function expectedAssessment(db,input){
 const {source,marks}=validatePreview(input);const track=input.track||null;
 if(track&&!CONDITIONS.includes(track))throw Error('想定馬場は良・稍重・重・不良から指定してください。');
 // Read each runner once. Human marks are never a model feature and do not select the ranking pool.
 const full=await expectedRunnerPreview(db,{...input,marks:source.names.map(horseName=>({horseName,mark:'注'}))});
 const histories=new Map(full.audit.historySidecar.map(h=>[h.horseName,h]));
 const all=rankAssessment(source.names.map(horseName=>({horseName,assessment:assessExpectedHistory(histories.get(horseName),source,track)})));
 const byName=new Map(all.map(x=>[x.horseName,x]));
 return{...full,audit:{...full.audit,marked:marks.map(m=>({...m,laboRank:null,laboScore:null})),historySidecar:marks.map(m=>histories.get(m.horseName))},
  assessment:{modelVersion:'existing-safe-core-1.5-expected-adapter-v1',stage:'provisional-evidence-assessment',trackAssumption:track,
   trackBasis:track?'user-scenario-not-confirmed-race-day-track':'unknown',runnerPool:all.length,
   scoredRunners:all.filter(r=>r.assessment.available).length,marked:marks.map(m=>({...byName.get(m.horseName),humanMark:m.mark})),allRunners:all,
   guardrails:{fullExpectedRunnerPool:true,humanMarksUsedInScore:false,noExternalFetch:true,lockedPredictionsModified:false,noForcedTieBreak:true,accuracyImprovementValidated:false,automaticMarksAssigned:false,targetResultUsed:false}}
 };
}
