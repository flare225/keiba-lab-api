export const LEARNING_POLICY={version:'prospective-evaluation-v1',modelVersion:'3.3.0-prospective',automaticTraining:false,automaticWeightUpdates:false,minTrainingRaces:30,minValidationRaces:10,thresholdsAreOperationalNotStatisticalProof:true,requiresFutureDaySeal:true,requiresCompleteResults:true,splitByWholeRaceDate:true};
const dateOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const axes=['basicAbilityResults','recentPerformanceDevelopment','paceStyleFit','courseDistanceFit','ground','conditionPrep'];
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pct=(a,b)=>b?Math.round(a/b*1000)/10:null;
const features=r=>Object.fromEntries(axes.map(k=>{const x=r.components?.[k];return[k,typeof x==='number'&&Number.isFinite(x)?x:null]}));
function metrics(races){let wins=0,top3=0,covered=0,sum=0,n=0;for(const r of races){const first=r.runners.find(x=>x.rank===1);if(first.finishPosition===1)wins++;if(first.finishPosition!=null&&first.finishPosition<=3)top3++;if(r.runners.some(x=>x.rank<=3&&x.finishPosition===1))covered++;if(first.finishPosition!=null){sum+=first.finishPosition;n++}}return{races:races.length,top1Wins:wins,top1WinRate:pct(wins,races.length),top1Top3:top3,top1Top3Rate:pct(top3,races.length),top3WinnerCoverageRate:pct(covered,races.length),averageTop1Finish:n?Math.round(sum/n*100)/100:null};}
export async function auditLearning({seals=[],outcomes=[],track='良',splitDate=null}={}){
 if(!['良','稍重','重','不良'].includes(track))throw Error('馬場の評価条件を確認できません。');
 if(splitDate&&!dateOk(splitDate))throw Error('検証開始日はYYYY-MM-DDで指定してください。');
 const grouped=new Map();for(const row of outcomes){const key=row.race_key;const arr=grouped.get(key)||[];arr.push(row);grouped.set(key,arr)}
 const rejected=[],pending=[],eligible=[],seen=new Set();
 for(const l of [...seals].sort((a,b)=>String(a.sealed_at).localeCompare(String(b.sealed_at)))){
  if(l.track_condition!==track)continue;
  const reject=reason=>rejected.push({raceKey:l.race_key,reason});let snapshot;
  if(l.model_version!==LEARNING_POLICY.modelVersion){reject('unsupported-model');continue}
  if(!dateOk(l.race_date)||Number(l.future_day_lock)!==1||Number(l.outcome_count_at_seal)!==0||l.seal_kind!=='prospective-holdout'||!Number.isFinite(Date.parse(l.sealed_at))||Date.parse(l.sealed_at)>=Date.parse(l.race_date+'T00:00:00+09:00')){reject('not-verified-before-race-day');continue}
  if(!l.snapshot_sha256||await digest(l.snapshot_json||'')!==l.snapshot_sha256){reject('snapshot-hash-mismatch');continue}
  try{snapshot=JSON.parse(l.snapshot_json)}catch{reject('invalid-snapshot');continue}
  if(snapshot?.race?.raceKey!==l.race_key||snapshot?.race?.date!==l.race_date||snapshot?.race?.trackCondition!==track||snapshot?.sealKind!=='prospective-holdout'||snapshot?.quality?.validationCreditEligible!==true||Number(snapshot?.quality?.outcomeCountAtSeal)!==0){reject('snapshot-metadata-mismatch');continue}
  const runners=snapshot.runners||[],count=Number(l.runner_count);
  if(!count||runners.length!==count||Number(snapshot.race.runnerCount)!==count||new Set(runners.map(x=>Number(x.horseNo))).size!==count||new Set(runners.map(x=>x.horseName)).size!==count||new Set(runners.map(x=>Number(x.rank))).size!==count||runners.some(x=>!x.horseName||!Number.isInteger(Number(x.horseNo))||Number(x.horseNo)<1||!Number.isInteger(Number(x.rank))||Number(x.rank)<1||Number(x.rank)>count)){reject('incomplete-or-ambiguous-runner-pool');continue}
  if(seen.has(l.race_key)){reject('duplicate-race-scenario');continue}seen.add(l.race_key);
  const result=grouped.get(l.race_key)||[],byNo=new Map(result.map(x=>[Number(x.horse_no),x]));
  const matching=result.length===count&&byNo.size===count&&runners.every(x=>byNo.get(Number(x.horseNo))?.horse_name===x.horseName);
  if(!matching){pending.push({raceKey:l.race_key,reason:'results-incomplete-or-identity-mismatch'});continue}
  const valid=r=>{const n=r.finish_position;if(n!=null)return Number.isInteger(Number(n))&&Number(n)>0&&Number(n)<=count;return['scratched','excluded','did-not-finish','disqualified'].includes(r.finish_status)};
  if(!result.every(valid)||!result.some(x=>Number(x.finish_position)===1)){pending.push({raceKey:l.race_key,reason:'finishing-status-unresolved'});continue}
  eligible.push({raceKey:l.race_key,date:l.race_date,sealedAt:l.sealed_at,snapshotSha256:l.snapshot_sha256,runners:runners.map(x=>{const o=byNo.get(Number(x.horseNo));return{horseNo:Number(x.horseNo),horseName:x.horseName,rank:Number(x.rank),features:features(x),finishPosition:o.finish_position==null?null:Number(o.finish_position),finishStatus:o.finish_status}})});
 }
 eligible.sort((a,b)=>a.date.localeCompare(b.date)||a.raceKey.localeCompare(b.raceKey));
 const training=splitDate?eligible.filter(x=>x.date<splitDate):[],validation=splitDate?eligible.filter(x=>x.date>=splitDate):[];
 const trainingDays=new Set(training.map(x=>x.date)).size,validationDays=new Set(validation.map(x=>x.date)).size;
 const featureReady=training.length>0&&training.every(r=>r.runners.every(x=>Object.values(x.features).filter(v=>v!=null).length>=2));
 const reasons=[];if(!splitDate)reasons.push('validation-date-not-fixed');if(training.length<30)reasons.push('too-few-training-races');if(validation.length<10)reasons.push('too-few-validation-races');if(trainingDays<2||validationDays<2)reasons.push('too-few-distinct-race-days');if(!featureReady)reasons.push('sealed-features-insufficient');
 return{ok:true,stage:'prospective-learning-readiness',policy:{...LEARNING_POLICY,trackScenario:track,splitDate},automaticTraining:false,trainingState:'not-started',strictEvaluatedRaces:eligible.length,pendingResultRaces:pending.length,rejectedSeals:rejected.length,canStartOfflineExperiment:reasons.length===0,reasons,overall:metrics(eligible),training:{...metrics(training),raceDays:trainingDays},validation:{...metrics(validation),raceDays:validationDays},details:eligible.map(({runners,...x})=>({...x,runnerCount:runners.length})),pending,rejected,guardrails:{sealedSnapshotHashesVerified:true,fullRunnerResultsRequired:true,onePredeclaredTrackScenario:true,targetResultsOnlyLabels:true,trainingAndValidationDatesDisjoint:true,noForecastOrWeightWrites:true,accuracyImprovementValidated:false}};
}
export async function learningReadiness(db,input={}){
 const from=input.from||'2026-09-01',to=input.to||'2999-12-31';if(!dateOk(from)||!dateOk(to)||from>to)throw Error('集計期間の日付を確認してください。');
 const seals=(await db.prepare("SELECT l.race_key,l.model_version,l.track_condition,l.seal_kind,l.snapshot_json,l.sealed_at,s.race_date,s.snapshot_sha256,s.runner_count,s.outcome_count_at_seal,s.future_day_lock FROM lab_model_locks l LEFT JOIN lab_prospective_seals s ON s.race_key=l.race_key AND s.model_version=l.model_version AND s.track_condition=l.track_condition WHERE l.model_version='3.3.0-prospective' AND substr(l.race_key,1,10)>=? AND substr(l.race_key,1,10)<=? ORDER BY l.sealed_at LIMIT 2001").bind(from,to).all()).results||[];
 if(seals.length>2000)throw Error('対象が多いため集計期間を短くしてください。');
 const outcomes=(await db.prepare("SELECT race_key,horse_no,horse_name,finish_position,finish_status FROM lab_race_result_details WHERE substr(race_key,1,10)>=? AND substr(race_key,1,10)<=? AND race_key IN (SELECT race_key FROM lab_model_locks WHERE model_version='3.3.0-prospective')").bind(from,to).all()).results||[];
 return{from,to,...await auditLearning({seals,outcomes,track:input.track||'良',splitDate:input.splitDate||null})};
}
