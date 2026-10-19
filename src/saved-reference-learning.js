import {readSavedPreRaceAssessment} from './saved-pre-race-assessment.js';
import {sha256} from './card-evidence.js';
import {BASE_WEIGHTS,candidateWeights,pairwiseConcordance} from './learning-experiment-v3.40.0.js';
export const SAVED_REFERENCE_PROTOCOL=Object.freeze({id:'saved-reference-shadow-20261019-v1',trainingThrough:'2026-10-19',minimumRaces:30,minimumDays:2,regularization:0.001,automaticPromotion:false});
const table='lab_saved_reference_training_runs_v1';
export async function readSavedReferenceTraining(db,hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('学習記録ハッシュを指定してください。');
 const row=await db.prepare(`SELECT record_json FROM ${table} WHERE run_sha256=?`).bind(hash).first();
 if(!row)return{ok:true,available:false};
 if(await sha256(row.record_json)!==hash)throw Error('学習記録のハッシュが一致しません。');
 return{ok:true,available:true,runSha256:hash,record:JSON.parse(row.record_json),integrityVerified:true};
}
export async function trainSavedReferences(db,input){
 const targets=input.targets;
 if(!Array.isArray(targets)||!targets.length||targets.length>100)throw Error('対象を1〜100レース指定してください。');
 const examples=[],evidence=[],seen=new Set(),models=new Set();
 for(const target of targets){
  const key=`${target.date}:${target.venue}:${target.raceNo}`;
  if(seen.has(key))throw Error('同じレースを重複指定できません。');seen.add(key);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target.date||'')||target.date>SAVED_REFERENCE_PROTOCOL.trainingThrough)throw Error('学習期間外のレースです。');
  const saved=await readSavedPreRaceAssessment(db,target),r=saved.record,c=saved.learningCandidate;
  if(!saved.available||!r.complete||!saved.preservedFeature?.integrityVerified||!c?.integrityVerified)throw Error('事前評価・結果ラベルの検証済み保存が必要です。');
  const label=c.record;
  if(label.cohort!=='saved-pre-race-reference-v1'||label.featureSha256!==saved.preservedFeature.featureSha256||label.guardrails?.postRaceReconstruction!==false)throw Error('学習候補の対応が不正です。');
  const runners=r.referenceAssessment.allRunners,labels=label.rows;
  if(!Array.isArray(labels)||labels.length!==runners.length||new Set(labels.map(x=>x.horseNo)).size!==runners.length)throw Error('全馬の結果対応が必要です。');
  const rows=runners.map(h=>{
   const l=labels.find(x=>x.horseNo===h.horseNo&&x.horseName===h.horseName);
   if(!l||l.referenceScore!==h.evidenceScore||l.referenceRank!==h.referenceRank||Object.keys(BASE_WEIGHTS).some(k=>!Number.isFinite(h.components?.[k])||h.components[k]<0||h.components[k]>100))throw Error('保存特徴量と結果が一致しません。');
   if(!(l.finishStatus==='finished'&&Number.isInteger(l.finishPosition)&&l.finishPosition>=1&&l.finishPosition<=runners.length||['scratched','excluded','did-not-finish','disqualified'].includes(l.finishStatus)&&l.finishPosition===null))throw Error('結果の形式が不正です。');
   return{components:h.components,finish:l.finishPosition};
  });
  if(!rows.some(x=>x.finish===1)||pairwiseConcordance(rows,BASE_WEIGHTS)===null)throw Error('勝馬を含む比較可能な結果が必要です。');
  const model=r.referenceAssessment.modelVersion;if(!model)throw Error('保存モデルの識別が必要です。');models.add(model);
  examples.push({key,date:target.date,rows});evidence.push({raceKey:key,revisionId:r.source.revisionId,featureSha256:saved.preservedFeature.featureSha256,labelSha256:c.labelSha256});
 }
 if(models.size!==1)throw Error('異なるモデルの特徴量は混合できません。');
 examples.sort((a,b)=>a.key.localeCompare(b.key));evidence.sort((a,b)=>a.raceKey.localeCompare(b.raceKey));
 const days=new Set(examples.map(x=>x.date)).size,ready=examples.length>=SAVED_REFERENCE_PROTOCOL.minimumRaces&&days>=SAVED_REFERENCE_PROTOCOL.minimumDays;
 let candidate=null;
 if(ready){
  const mean=w=>examples.reduce((n,x)=>n+pairwiseConcordance(x.rows,w),0)/examples.length;
  const baseline=mean(BASE_WEIGHTS);let best={weights:{...BASE_WEIGHTS},concordance:baseline,objective:baseline};
  for(const weights of candidateWeights().slice(1)){const concordance=mean(weights),distance=Object.keys(BASE_WEIGHTS).reduce((n,k)=>n+Math.abs(weights[k]-BASE_WEIGHTS[k]),0)/10,objective=concordance-SAVED_REFERENCE_PROTOCOL.regularization*distance;if(objective>best.objective+1e-9)best={weights,concordance,objective};}
  candidate={weights:best.weights,trainingConcordance:best.concordance,baselineTrainingConcordance:baseline};
 }
 const record={protocol:SAVED_REFERENCE_PROTOCOL,sourceModel:[...models][0],status:ready?'fitted-shadow-only':'awaiting-training-data',trainingRaces:examples.length,trainingDays:days,remainingRaces:Math.max(0,SAVED_REFERENCE_PROTOCOL.minimumRaces-examples.length),evidence,candidate,guardrails:{originalScoresPreserved:true,targetResultsUsedOnlyAsLabels:true,frozenExperimentModified:false,userLocksModified:false,automaticPromotion:false,accuracyImprovementValidated:false,futureValidationRequired:true}};
 const body=JSON.stringify(record),hash=await sha256(body);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${table}(run_sha256 TEXT PRIMARY KEY,record_json TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS saved_reference_training_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'training run is immutable'); END`).run();
 try{
  const result=await db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?)`).bind(hash,body).run();
  const read=await readSavedReferenceTraining(db,hash);
  if(!read.available||JSON.stringify(read.record)!==body)throw Error('学習記録の読み返しが一致しません。');
  return{...read,saved:Number(result.meta?.changes)||0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
