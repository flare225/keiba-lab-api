import {readAutomaticLearningCandidate,AUTOMATIC_COHORT} from './automatic-learning-candidates.js';
import {fitReferenceShadowExamples} from './saved-reference-learning.js';
import {BASE_WEIGHTS,pairwiseConcordance} from './learning-experiment-v3.40.0.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
import {jstDay} from './history-collection-v3.37.0.js';
import {sha256} from './card-evidence.js';
const TABLE='lab_automatic_shadow_training_v1';
const validDate=d=>/^20\d{2}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function automaticTrainingProtocol(input,now=Date.now()){
 const {trainingThrough,validationFrom}=input,today=jstDay(now);
 if(!validDate(trainingThrough)||!validDate(validationFrom)||trainingThrough>=today||validationFrom<=today||validationFrom<=trainingThrough)throw Error('学習締切は前日以前、将来検証開始は翌日以降を指定してください。');
 return{id:'automatic-reference-shadow-v1:'+trainingThrough+':'+validationFrom,cohort:AUTOMATIC_COHORT,trainingThrough,validationFrom,minimumRaces:30,minimumDays:2,minimumValidationRaces:10,minimumValidationDays:2,regularization:0.001,automaticPromotion:false};
}
export async function readAutomaticTraining(db,hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('学習記録のハッシュを指定してください。');
 let row;try{row=await db.prepare(`SELECT record_json,created_at FROM ${TABLE} WHERE run_sha256=?`).bind(hash).first();}catch(e){if(/no such table/.test(String(e)))return{ok:true,available:false};throw e;}
 if(!row)return{ok:true,available:false};if(await sha256(row.record_json)!==hash)throw Error('自動予想学習記録のハッシュが一致しません。');
 const record=JSON.parse(row.record_json);if(record.protocol?.cohort!==AUTOMATIC_COHORT||record.guardrails?.automaticPromotion!==false)throw Error('自動予想学習記録のcohortが一致しません。');
 return{ok:true,available:true,integrityVerified:true,runSha256:hash,createdAt:row.created_at,record};
}
export function validateAutomaticTrainingInput(input,now=Date.now()){
 const protocol=automaticTrainingProtocol(input,now),targets=input.targets;
 if(!Array.isArray(targets)||!targets.length||targets.length>100)throw Error('対象は1〜100レースを指定してください。');
 const normalized=targets.map(targetInput),keys=normalized.map(t=>`${t.date}:${t.venue}:${t.raceNo}`);
 if(new Set(keys).size!==keys.length||normalized.some(t=>t.date>protocol.trainingThrough))throw Error('重複レースまたは学習期間外の対象です。');
 return{protocol,normalized,keys};
}
export async function trainAutomaticReferences(db,input,now=Date.now()){
 const {protocol,normalized,keys}=validateAutomaticTrainingInput(input,now);
 const examples=[],evidence=[],models=new Set();
 for(let i=0;i<normalized.length;i++){
  const t=normalized[i],saved=await readAutomaticLearningCandidate(db,t,{includeOriginal:true});
  if(!saved.integrityVerified||!saved.originalPrediction)throw Error('独立事前予想と公式結果の検証済み学習候補が必要です。');
  const label=saved.record,original=saved.originalPrediction,runners=original.runners,rows=label.rows;
  if(label.cohort!==protocol.cohort||label.predictionSavedAt!==original.savedAt||label.guardrails?.originalScoresPreserved!==true||label.guardrails?.postRaceReconstruction!==false||original.guardrails?.humanMarksUsed!==false||original.guardrails?.targetResultUsed!==false||original.guardrails?.immutable!==true||typeof label.modelVersion!=='string'||!label.modelVersion.trim()||original.race.runnerCount!==runners?.length||original.card?.length!==runners?.length||rows?.length!==runners?.length||new Set(runners.map(h=>h.horseNo)).size!==runners.length||new Set(rows.map(x=>x.horseNo)).size!==rows.length)throw Error('独立事前評価の由来・全馬対応が一致しません。');
  const training=runners.map(h=>{
   const row=rows.find(r=>r.horseNo===h.horseNo&&r.horseName===h.horseName),components=h.assessment?.components;
   if(!row||!Number.isFinite(h.score)||h.score<0||h.score>100||!Number.isInteger(h.rank)||h.rank<1||h.rank>rows.length||row.referenceScore!==h.score||row.referenceRank!==h.rank||row.referenceMark!==h.mark||!original.card.some(c=>Number(c.horse_no)===h.horseNo&&c.horse_name===h.horseName)||JSON.stringify(row.components)!==JSON.stringify(components)||Object.keys(BASE_WEIGHTS).some(k=>!Number.isFinite(components?.[k])||components[k]<0||components[k]>100))throw Error('保存時の特徴量・順位・スコアが一致しません。');
   if(!(row.finishStatus==='finished'&&Number.isInteger(row.finishPosition)&&row.finishPosition>=1&&row.finishPosition<=rows.length||['scratched','excluded','did-not-finish','disqualified'].includes(row.finishStatus)&&row.finishPosition===null))throw Error('公式結果ラベルの形式が不正です。');
   return{components,finish:row.finishPosition};
  });
  if(!training.some(r=>r.finish===1)||pairwiseConcordance(training,BASE_WEIGHTS)===null)throw Error('勝馬を含む比較可能な結果が必要です。');
  models.add(label.modelVersion);examples.push({key:keys[i],date:t.date,rows:training});evidence.push({raceKey:keys[i],predictionSha256:label.predictionSha256,labelSha256:saved.labelSha256});
 }
 if(models.size!==1)throw Error('異なるモデルは同じ学習へ混合できません。');
 examples.sort((a,b)=>a.key.localeCompare(b.key));evidence.sort((a,b)=>a.raceKey.localeCompare(b.raceKey));
 const {ready,days,candidate}=fitReferenceShadowExamples(examples,protocol);
 const record={protocol,sourceModel:[...models][0],status:ready?'fitted-shadow-only':'awaiting-training-data',trainingRaces:examples.length,trainingDays:days,remainingRaces:Math.max(0,protocol.minimumRaces-examples.length),evidence,candidate,guardrails:{humanMarksRequired:false,originalScoresPreserved:true,targetResultsUsedOnlyAsLabels:true,postRaceReconstruction:false,userLocksModified:false,frozenExperimentModified:false,automaticPromotion:false,accuracyImprovementValidated:false,futureValidationRequired:true,canReviewCandidate:false}};
 const body=JSON.stringify(record),hash=await sha256(body);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(run_sha256 TEXT PRIMARY KEY,record_json TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS automatic_training_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'automatic shadow training is immutable'); END`).run();
 try{
  const result=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?)`).bind(hash,body,new Date(now).toISOString()).run();
  const read=await readAutomaticTraining(db,hash);if(!read.integrityVerified||JSON.stringify(read.record)!==body)throw Error('自動予想学習記録の読み返しが一致しません。');
  return{...read,saved:Number(result.meta?.changes)||0,externalRequests:0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
