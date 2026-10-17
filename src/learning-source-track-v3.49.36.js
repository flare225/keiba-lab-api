import {EXPECTED_SOURCES,historyForExpected} from './expected-runner-preview-v3.30.0.js';
import {assessmentContext,targetInput} from './race-history-assessment-v3.31.0.js';
import {assessExpectedHistory} from './expected-assessment-v3.31.0.js';
import {assertBeforeOfficialStart,featureCapturedBeforeOfficialStart,BASE_WEIGHTS,hash} from './learning-experiment-v3.40.0.js';
import {jstDay} from './history-collection-v3.32.0.js';
import {resultWindowOpen} from './official-result-sources-v3.39.0.js';

// A separately versioned, result-blind feature lane. It never writes to the
// JRA history tables or the existing core experiment.
export const SOURCE_TRACK={id:'netkeiba-history-shadow-20261018-v1',provider:'netkeiba',featureVersion:'secondary-history-assessment-v1',trainingFrom:'2026-10-18',validationFrom:'2027-01-01',trackScenario:null,minimumTrainingRaces:30,minimumTrainingDays:2,minimumValidationRaces:10,minimumValidationDays:2,objective:'mean-race-pairwise-concordance',automaticPromotion:false,changesCurrentMarks:false};
const keys=Object.keys(BASE_WEIGHTS),json=x=>JSON.stringify(x);

export async function ensureSourceTrack(db){
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS lab_learning_source_protocols(id TEXT PRIMARY KEY,protocol_json TEXT NOT NULL,protocol_sha256 TEXT NOT NULL,frozen_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS lab_learning_source_features(track_id TEXT NOT NULL,race_key TEXT NOT NULL,race_date TEXT NOT NULL,phase TEXT NOT NULL,provider TEXT NOT NULL,snapshot_id TEXT NOT NULL,source_url TEXT NOT NULL,observed_at TEXT,features_json TEXT NOT NULL,features_sha256 TEXT NOT NULL,captured_at TEXT NOT NULL,PRIMARY KEY(track_id,race_key))',
  'CREATE TABLE IF NOT EXISTS lab_learning_source_labels(track_id TEXT NOT NULL,race_key TEXT NOT NULL,labels_json TEXT NOT NULL,labels_sha256 TEXT NOT NULL,attached_at TEXT NOT NULL,PRIMARY KEY(track_id,race_key))',
  'CREATE TABLE IF NOT EXISTS lab_learning_source_candidates(track_id TEXT PRIMARY KEY,candidate_json TEXT NOT NULL,candidate_sha256 TEXT NOT NULL,fitted_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS lab_learning_source_receipts(track_id TEXT NOT NULL,race_key TEXT NOT NULL,status TEXT NOT NULL,missing_horses_json TEXT NOT NULL,last_attempt_at TEXT NOT NULL,PRIMARY KEY(track_id,race_key))'
 ])await db.prepare(sql).run();
 for(const table of ['lab_learning_source_protocols','lab_learning_source_features','lab_learning_source_labels','lab_learning_source_candidates'])for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'source track records are immutable'); END`).run();
 const body=json(SOURCE_TRACK),sha=await hash(body),old=await db.prepare('SELECT protocol_json,protocol_sha256 FROM lab_learning_source_protocols WHERE id=?').bind(SOURCE_TRACK.id).first();
 if(old){if(old.protocol_json!==body||old.protocol_sha256!==sha||await hash(old.protocol_json)!==old.protocol_sha256)throw Error('二次ソース実験条件の固定値が一致しません。')}
 else await db.prepare('INSERT OR IGNORE INTO lab_learning_source_protocols VALUES(?,?,?,?)').bind(SOURCE_TRACK.id,body,sha,new Date().toISOString()).run();
}

export async function captureSourceTrackRace(db,input,now=Date.now()){
 await ensureSourceTrack(db);const t=targetInput(input),today=jstDay(now);
 if(t.date<today)throw Error('開催後に事前特徴量を作成できません。');
 const context=await assessmentContext(db,t);if(!context.official)throw Error('JRA正式出馬表が未保存です。');
 const source=EXPECTED_SOURCES.find(x=>x.date===t.date&&x.venue===t.venue&&x.raceNo===t.raceNo&&x.provider==='netkeiba');
 if(!source)return{ok:true,status:'awaiting-secondary-source-snapshot',raceKey:context.raceKey,externalRequests:0,featureSaved:false};
 if(t.date===today)await assertBeforeOfficialStart(db,context,now);
 const old=await db.prepare('SELECT * FROM lab_learning_source_features WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,context.raceKey).first();
 if(old){if(await hash(old.features_json)!==old.features_sha256)throw Error('保存済み二次ソース特徴量のハッシュが一致しません。');return{ok:true,status:'already-saved',raceKey:context.raceKey,phase:old.phase,featureSaved:true,featuresSha256:old.features_sha256,...await attachSourceLabels(db,old,now)}}
 const phase=t.date<SOURCE_TRACK.validationFrom?'training':'validation',candidate=phase==='validation'?await db.prepare('SELECT * FROM lab_learning_source_candidates WHERE track_id=?').bind(SOURCE_TRACK.id).first():null;
 if(phase==='validation'&&!candidate)return{ok:true,status:'awaiting-source-candidate',raceKey:context.raceKey,phase,featureSaved:false,externalRequests:0};
 if(candidate&&await hash(candidate.candidate_json)!==candidate.candidate_sha256)throw Error('二次ソース学習候補のハッシュが一致しません。');
 const candidateData=candidate?JSON.parse(candidate.candidate_json):null,runners=[],missing=[];
 for(const runner of context.runners){
  const history=await historyForExpected(db,{...context,age:Number(runner.age),snapshotId:source.snapshotId},runner.horse_name);
  // When netkeiba is the only stored provider, historyForExpected correctly
  // makes it the primary row; when official history also exists, it places
  // the netkeiba rows in supplementalRecent. Select only that provider from
  // either lane so no fields are combined across sources.
  const sourceRows=[...history.recent.filter(row=>row.dbSource==='netkeiba-dated-history'),...history.supplementalRecent];
  const distinctRows=[...new Map(sourceRows.map(row=>[row.date+'|'+row.venue,row])).values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  if(distinctRows.some(row=>row.date>=t.date||row.dbSource!=='netkeiba-dated-history'))throw Error('開催日前またはソース分離の条件を満たさない履歴です。');
  const assessment=assessExpectedHistory({available:distinctRows.length>0,recent:distinctRows,warnings:[]},context,SOURCE_TRACK.trackScenario);
  if(!assessment.available)missing.push(runner.horse_name);
  runners.push({horseNo:Number(runner.horse_no),horseName:runner.horse_name,components:Object.fromEntries(keys.map(k=>[k,assessment.components?.[k]??null])),historyRows:distinctRows.length,historicalDates:distinctRows.map(x=>x.date),sourceEvidence:distinctRows.flatMap(x=>x.sourceEvidence||[]),scoreAvailable:assessment.available});
 }
 const evidence=runners.flatMap(x=>x.sourceEvidence),urls=[...new Set(evidence.map(x=>x.sourceUrl).filter(Boolean))];
 if(!urls.length){const at=new Date(now).toISOString();await db.prepare('INSERT INTO lab_learning_source_receipts VALUES(?,?,?,?,?) ON CONFLICT(track_id,race_key) DO UPDATE SET status=excluded.status,missing_horses_json=excluded.missing_horses_json,last_attempt_at=excluded.last_attempt_at').bind(SOURCE_TRACK.id,context.raceKey,'awaiting-source-history',json(missing),at).run();return{ok:true,status:'awaiting-source-history',raceKey:context.raceKey,phase,featureSaved:false,missingHistoryHorses:missing,externalRequests:0}}
 if(evidence.some(x=>x.provider!=='netkeiba-dated-history')||urls.length!==1)throw Error('二次ソースの出典を1つに特定できません。');
 const completeRunnerPool=missing.length===0,body=json({featureVersion:SOURCE_TRACK.featureVersion,trackId:SOURCE_TRACK.id,provider:SOURCE_TRACK.provider,snapshotId:source.snapshotId,sourceUrl:urls[0],observedAt:source.observedAt||null,race:{raceKey:context.raceKey,date:context.date,venue:context.venue,raceNo:context.raceNo,surface:context.surface,distance:context.distance},phase,candidateSha256:candidate?.candidate_sha256||null,completeRunnerPool,missingHorses:missing,runners:runners.map(({sourceEvidence,...row})=>({...row,score:weighted(row.components),baselineScore:weighted(row.components),candidateScore:candidateData?weighted(row.components,candidateData.weights):null})),guardrails:{targetResultRead:false,jraValuesMixed:false,marksRead:false,lockMutation:false,postRaceCapture:false,probabilitiesClaimed:false,automaticPromotion:false}}),sha=await hash(body),at=new Date(now).toISOString();
 await db.prepare('INSERT OR IGNORE INTO lab_learning_source_features VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(SOURCE_TRACK.id,context.raceKey,t.date,phase,SOURCE_TRACK.provider,source.snapshotId,urls[0],source.observedAt||null,body,sha,at).run();
 const stored=await db.prepare('SELECT features_sha256 FROM lab_learning_source_features WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,context.raceKey).first();
 const feature=await db.prepare('SELECT * FROM lab_learning_source_features WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,context.raceKey).first();
 return{ok:true,status:completeRunnerPool?'features-saved':'partial-feature-saved',raceKey:context.raceKey,phase,featureSaved:true,runnerCount:runners.length,provider:SOURCE_TRACK.provider,snapshotId:source.snapshotId,sourceUrl:urls[0],observedAt:source.observedAt||null,featuresSha256:stored.features_sha256,missingHistoryHorses:missing,eligibleForTraining:completeRunnerPool,externalRequests:0,...await attachSourceLabels(db,feature,now)};
}

function weighted(components,weights=BASE_WEIGHTS){let total=0,weight=0;for(const key of keys){const value=components?.[key],w=weights[key];if(Number.isFinite(value)){total+=value*w;weight+=w}}return weight?total/weight:null}

function sourceCandidateWeights(){const all=[{...BASE_WEIGHTS}];for(let i=0;i<keys.length;i++)for(let j=0;j<keys.length;j++)if(i!==j&&BASE_WEIGHTS[keys[j]]>5)all.push({...BASE_WEIGHTS,[keys[i]]:BASE_WEIGHTS[keys[i]]+5,[keys[j]]:BASE_WEIGHTS[keys[j]]-5});return all}
function sourceConcordance(rows,weights){let sum=0,n=0;for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.finish==null||b.finish==null||a.finish===b.finish||a.score==null||b.score==null)continue;const delta=a.score-b.score;sum+=Math.abs(delta)<1e-9?0.5:(delta*(b.finish-a.finish)>0?1:0);n++}return n?sum/n:null}
export function fitSourceCandidateFromExamples(examples){
 if(examples.some(x=>x.phase!=='training'||x.date<SOURCE_TRACK.trainingFrom||x.date>=SOURCE_TRACK.validationFrom))throw Error('検証用・対象日以降のデータは二次ソース学習に使えません。');
 const eligible=examples.filter(x=>x.completeRunnerPool&&x.runners.length>=2&&x.runners.every(r=>Number.isFinite(weighted(r.components)))&&x.runners.some(r=>r.finish===1)&&sourceConcordance(x.runners.map(r=>({...r,score:weighted(r.components,BASE_WEIGHTS)})),BASE_WEIGHTS)!=null),days=new Set(eligible.map(x=>x.date));
 if(eligible.length<SOURCE_TRACK.minimumTrainingRaces||days.size<SOURCE_TRACK.minimumTrainingDays)return{status:'awaiting-training-data',trainingRaces:eligible.length,trainingDays:days.size};
 const pool=eligible.sort((a,b)=>a.date.localeCompare(b.date)||a.raceKey.localeCompare(b.raceKey)),mean=weights=>{const values=pool.map(x=>sourceConcordance(x.runners.map(r=>({...r,score:weighted(r.components,weights)})),weights)).filter(x=>x!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
 const baseline=mean(BASE_WEIGHTS);let chosen={weights:{...BASE_WEIGHTS},concordance:baseline};for(const weights of sourceCandidateWeights().slice(1)){const c=mean(weights),distance=keys.reduce((n,k)=>n+Math.abs(weights[k]-BASE_WEIGHTS[k]),0)/10;if(c-0.001*distance>(chosen.concordance??-Infinity)+1e-9)chosen={weights,concordance:c}}
 return{status:'candidate-fitted',trackId:SOURCE_TRACK.id,weights:chosen.weights,baselineWeights:BASE_WEIGHTS,trainingRaces:pool.length,trainingDays:days.size,trainingConcordance:chosen.concordance,baselineTrainingConcordance:baseline,validationUsedForSelection:false,automaticPromotion:false};
}
async function sourceTrainingExamples(db){const rows=(await db.prepare('SELECT f.*,l.labels_json,l.labels_sha256 FROM lab_learning_source_features f JOIN lab_learning_source_labels l ON l.track_id=f.track_id AND l.race_key=f.race_key WHERE f.track_id=? AND f.phase=\'training\' AND f.race_date<? ORDER BY f.race_date,f.race_key LIMIT 200').bind(SOURCE_TRACK.id,SOURCE_TRACK.validationFrom).all()).results||[],out=[];for(const row of rows){if(await hash(row.features_json)!==row.features_sha256||await hash(row.labels_json)!==row.labels_sha256)throw Error('二次ソース学習データのハッシュが一致しません。');const f=JSON.parse(row.features_json);if(!f.completeRunnerPool)continue;const labels=JSON.parse(row.labels_json);out.push({raceKey:row.race_key,date:row.race_date,phase:row.phase,completeRunnerPool:f.completeRunnerPool,runners:f.runners.map(r=>({...r,finish:labels.find(x=>Number(x.horse_no)===r.horseNo)?.finish_position??null}))})}return out}
async function persistSourceCandidate(db,now){const old=await db.prepare('SELECT candidate_json,candidate_sha256 FROM lab_learning_source_candidates WHERE track_id=?').bind(SOURCE_TRACK.id).first();if(old){if(await hash(old.candidate_json)!==old.candidate_sha256)throw Error('二次ソース学習候補のハッシュが一致しません。');return{status:'candidate-already-fitted'}}const fit=fitSourceCandidateFromExamples(await sourceTrainingExamples(db));if(fit.status!=='candidate-fitted')return fit;const body=json({...fit,fittedAt:new Date(now).toISOString()}),sha=await hash(body);await db.prepare('INSERT OR IGNORE INTO lab_learning_source_candidates VALUES(?,?,?,?)').bind(SOURCE_TRACK.id,body,sha,new Date(now).toISOString()).run();return{...fit,candidateSha256:sha}}
async function sourceTrackValidation(db,candidate){if(!candidate)return{races:0,raceDays:0,baselineConcordance:null,candidateConcordance:null,canReviewCandidate:false};const candidateData=JSON.parse(candidate.candidate_json),records=(await db.prepare('SELECT f.*,l.labels_json,l.labels_sha256 FROM lab_learning_source_features f JOIN lab_learning_source_labels l ON l.track_id=f.track_id AND l.race_key=f.race_key WHERE f.track_id=? AND f.phase=\'validation\' ORDER BY f.race_date,f.race_key LIMIT 200').bind(SOURCE_TRACK.id).all()).results||[],validation=[];for(const row of records){if(await hash(row.features_json)!==row.features_sha256||await hash(row.labels_json)!==row.labels_sha256)throw Error('二次ソース検証データのハッシュが一致しません。');const f=JSON.parse(row.features_json),labels=JSON.parse(row.labels_json);if(!f.completeRunnerPool||f.candidateSha256!==candidate.candidate_sha256||!await featureCapturedBeforeOfficialStart(db,f.race,Date.parse(row.captured_at)))continue;validation.push({date:row.race_date,runners:f.runners.map(r=>({...r,finish:labels.find(x=>Number(x.horse_no)===r.horseNo)?.finish_position??null}))})}const metrics=key=>{const values=validation.map(x=>sourceConcordance(x.runners.map(r=>({...r,score:r[key]})),BASE_WEIGHTS)).filter(x=>x!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null};return{races:validation.length,raceDays:new Set(validation.map(x=>x.date)).size,baselineConcordance:metrics('baselineScore'),candidateConcordance:metrics('candidateScore'),canReviewCandidate:validation.length>=SOURCE_TRACK.minimumValidationRaces&&new Set(validation.map(x=>x.date)).size>=SOURCE_TRACK.minimumValidationDays,selectionUsedValidation:false,automaticPromotion:false}}

export async function sourceTrackStatus(db){
 await ensureSourceTrack(db);const rows=(await db.prepare('SELECT f.phase,COUNT(*) AS feature_races,COUNT(l.race_key) AS labelled_races FROM lab_learning_source_features f LEFT JOIN lab_learning_source_labels l ON l.track_id=f.track_id AND l.race_key=f.race_key WHERE f.track_id=? GROUP BY f.phase').bind(SOURCE_TRACK.id).all()).results||[];
 const candidate=await db.prepare('SELECT candidate_json,candidate_sha256 FROM lab_learning_source_candidates WHERE track_id=?').bind(SOURCE_TRACK.id).first();if(candidate&&await hash(candidate.candidate_json)!==candidate.candidate_sha256)throw Error('二次ソース学習候補のハッシュが一致しません。');
 const validation=await sourceTrackValidation(db,candidate);
 let waiting=[];try{waiting=(await db.prepare('SELECT race_key,status,missing_horses_json,last_attempt_at FROM lab_learning_source_receipts WHERE track_id=? ORDER BY last_attempt_at DESC LIMIT 12').bind(SOURCE_TRACK.id).all()).results||[]}catch{}
 return{ok:true,track:SOURCE_TRACK,counts:rows,waiting:waiting.map(x=>({raceKey:x.race_key,status:x.status,missingHistoryHorses:JSON.parse(x.missing_horses_json),lastAttemptAt:x.last_attempt_at})),candidate:candidate?JSON.parse(candidate.candidate_json):null,validation,automaticPromotion:false,featuresModifyCurrentPrediction:false};
}

async function attachSourceLabels(db,feature,now){
 const existing=await db.prepare('SELECT labels_sha256 FROM lab_learning_source_labels WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,feature.race_key).first();if(existing)return{labelStatus:'labels-already-saved'};
 const snapshot=JSON.parse(feature.features_json),race=snapshot.race,today=jstDay(now);if(!snapshot.completeRunnerPool)return{labelStatus:'ineligible-incomplete-runner-pool'};if(race.date>today||(race.date===today&&!await resultWindowOpen(db,race.date,race.venue,race.raceNo,now)))return{labelStatus:'awaiting-results'};
 const runners=snapshot.runners,labels=(await db.prepare('SELECT horse_no,horse_name,finish_position,finish_status,source_url,source_sha256 FROM lab_race_result_details WHERE race_key=? ORDER BY horse_no').bind(feature.race_key).all()).results||[];
 if(labels.length!==runners.length||new Set(labels.map(x=>Number(x.horse_no))).size!==labels.length||!runners.every(r=>labels.some(x=>Number(x.horse_no)===r.horseNo&&x.horse_name===r.horseName)))return{labelStatus:'awaiting-complete-official-results'};
 if(!labels.every(row=>{try{const u=new URL(row.source_url);return u.protocol==='https:'&&['jra.go.jp','www.jra.go.jp','jra.jp','www.jra.jp'].includes(u.hostname)&&!!row.source_sha256&&(row.finish_position!=null?(Number.isInteger(Number(row.finish_position))&&Number(row.finish_position)>0&&Number(row.finish_position)<=labels.length):['scratched','excluded','did-not-finish','disqualified'].includes(row.finish_status))}catch{return false}})||!labels.some(x=>Number(x.finish_position)===1))return{labelStatus:'awaiting-verified-official-results'};
 const body=json(labels),sha=await hash(body);await db.prepare('INSERT OR IGNORE INTO lab_learning_source_labels VALUES(?,?,?,?,?)').bind(SOURCE_TRACK.id,feature.race_key,body,sha,new Date(now).toISOString()).run();return{labelStatus:'labels-saved',labelCount:labels.length};
}

export async function scheduledSourceTrack(db,now=Date.now()){
 await ensureSourceTrack(db);const today=jstDay(now),targets=EXPECTED_SOURCES.filter(x=>x.provider==='netkeiba'&&x.date>=today&&x.date>=SOURCE_TRACK.trainingFrom).sort((a,b)=>a.date.localeCompare(b.date)||a.raceNo-b.raceNo);
 const unlabelled=(await db.prepare('SELECT f.* FROM lab_learning_source_features f LEFT JOIN lab_learning_source_labels l ON l.track_id=f.track_id AND l.race_key=f.race_key WHERE f.track_id=? AND f.race_date<=? AND l.race_key IS NULL ORDER BY f.race_date,f.race_key LIMIT 1').bind(SOURCE_TRACK.id,today).all()).results||[];
 if(unlabelled.length){const f=unlabelled[0],labelResult=await attachSourceLabels(db,f,now);if(labelResult.labelStatus==='labels-saved')return{ok:true,status:'labels-saved',raceKey:f.race_key,externalRequests:0,...labelResult};}
 const fitted=await persistSourceCandidate(db,now);if(fitted.status==='candidate-fitted')return{ok:true,...fitted,externalRequests:0};
 for(const source of targets){
  const race=await db.prepare('SELECT race_key FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(source.date,source.venue,source.raceNo).first();if(!race)continue;
  const done=await db.prepare('SELECT race_key FROM lab_learning_source_features WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,race.race_key).first();if(done)continue;
  const receipt=await db.prepare('SELECT last_attempt_at FROM lab_learning_source_receipts WHERE track_id=? AND race_key=?').bind(SOURCE_TRACK.id,race.race_key).first();if(receipt&&Date.parse(receipt.last_attempt_at)>now-3600000)continue;
  return captureSourceTrackRace(db,{date:source.date,venue:source.venue,raceNo:source.raceNo},now);
 }
 return{ok:true,status:'idle',externalRequests:0,trainingStatus:fitted.status,reason:'no-upcoming-netkeiba-snapshot-with-official-card'};
}
