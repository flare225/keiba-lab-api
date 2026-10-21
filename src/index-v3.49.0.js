import {readProvisionalPrediction,saveProvisionalPrediction} from './provisional-prediction-snapshots.js';
import {provisionalExpectedPrediction,repairStoredProgramConditions} from './provisional-expected-prediction.js';
import {validateAutomaticReferences,readAutomaticValidation,validateAutomaticValidationInput} from './automatic-reference-validation.js';
import {trainAutomaticReferences,readAutomaticTraining,validateAutomaticTrainingInput} from './automatic-reference-training.js';
import {readPrecardRaceState,PRECARD_STATE_PATHS} from './precard-race-state.js';
import {PREVIEW_GUARDS} from './expected-runner-preview-v3.30.0.js';
import {readAutomaticLearningCandidate,labelAutomaticPrediction,scheduledAutomaticCandidates} from './automatic-learning-candidates.js';
import {readReviewedUpcomingHistory,importReviewedUpcomingHistory} from './reviewed-upcoming-history.js';
import {resolveExpectedCollectionSource} from './index-v3.46.0.js';
import {readAutomaticPrediction,captureAutomaticPrediction,scheduledAutomaticPrediction,recoverOldAutomaticPrediction} from './automatic-pre-race-prediction.js';
import {trainSavedReferences,readSavedReferenceTraining} from './saved-reference-learning.js';
import {importExpectedRosterSeed} from './expected-roster-seeds.js';
import {saveExpectedRoster} from './expected-roster-registry.js';
import {weekDataInventory} from './week-data-inventory.js';
import {readSavedPreRaceAssessment,preserveSavedPreRaceAssessment,labelSavedPreRaceAssessment} from './saved-pre-race-assessment.js';
import {capturePostRaceAssessment,readPostRaceAssessments,postRaceAssessmentPage} from './post-race-assessment.js';
import {missingOfficialCards,collectMissingOfficialCard} from './missing-official-cards.js';
import {verifyEditorialClaims} from './editorial-claim-verification.js';
import {seedEditorialReferences,readEditorialReferences,editorialReferencePage} from './editorial-reference-notes.js';
import {scheduledReadStatus,runWithScheduledReadBudget,scheduledBudgetLane} from './scheduled-read-budget.js';
import {COLLECTION_READ_POLICY,shouldRunScheduled} from './collection-read-policy.js';
import {runPipelineJob} from './pipeline-runs-v3.40.0.js';
import {priorDetailStatus,collectPriorDetails} from './prior-result-details.js';
import {collectLockedMarkResults,readLockedMarkResults} from './locked-mark-result-evidence.js';
import {userMarkLockEndpoint,readUserMarkLock} from './user-mark-lock.js';
import app from './index-v3.48.2.js';
import {markRecordProvenance} from './mark-record-provenance.js';
import {workoutEndpoint} from './workout-evidence-v3.49.0.js';
import {dispatchLiveSources} from './live-source-dispatch.js';
import {upcomingOfficialHistoryPlan} from './upcoming-official-history.js';
import {captureSourceTrackRace,sourceTrackStatus} from './learning-source-track-v3.49.36.js';
import {learningSourceTrackPage} from './learning-source-track-page-v3.49.36.js';
import {statusCacheKey,readStatusCache,writeStatusCache} from './status-read-cache.js';
export const VERSION='3.49.48';
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(request.method==='GET'&&u.searchParams.has('date')&&PRECARD_STATE_PATHS.has(u.pathname)){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   try{const pending=await readPrecardRaceState(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')||u.searchParams.get('raceNo')});if(pending)return Response.json({...pending.data,version:VERSION},{status:pending.status,headers});}
   catch(e){console.error('precard state read failed',String(e.message||e));return Response.json({ok:false,status:'state-unavailable',error:'対象レースの保存状態を確認できません。'},{status:503,headers});}
  }
  if(u.pathname==='/v1/lab/expected-runners'&&request.method==='GET'&&u.searchParams.has('date')){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   try{
    const source=await resolveExpectedCollectionSource(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});
    if(!source)return Response.json({ok:false,version:VERSION,error:'対象レースの想定名簿は未保存です。'},{status:404,headers});
    return Response.json({ok:true,version:VERSION,source:{...source,names:undefined},runners:source.names.map(horseName=>({horseName,horseNo:null,frameNo:null,age:source.ages?.[horseName]??source.age??null})),guardrails:PREVIEW_GUARDS},{headers});
   }catch(e){return Response.json({ok:false,version:VERSION,error:String(e.message||e)},{status:409,headers})}
  }

  if(u.pathname==='/v1/lab/automatic-learning-candidate'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    const b=request.method==='GET'?{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')}:request.method==='POST'?await request.json():null;
    if(!b)return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    if(request.method==='POST'&&b.confirm!=='LABEL')throw Error('confirm LABEL is required');
    const data=await(request.method==='GET'?readAutomaticLearningCandidate(env.DB,b):labelAutomaticPrediction(env.DB,b));return Response.json({...data,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers})}
  }

  if(u.pathname==='/v1/lab/reviewed-upcoming-history'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   try{
    const b=request.method==='GET'?{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')}:request.method==='POST'?await request.json():null;
    if(!b)return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    if(request.method==='POST'&&b.confirm!=='IMPORT_BUNDLED')throw Error('confirm IMPORT_BUNDLED is required');
    const source=await resolveExpectedCollectionSource(env.DB,b);if(!source)throw Error('登録名簿がありません');
    const data=await(request.method==='GET'?readReviewedUpcomingHistory(env.DB,source):importReviewedUpcomingHistory(env.DB,source));return Response.json({...data,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers})}
  }

  if(u.pathname==='/v1/lab/provisional-prediction-snapshot'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{const b=request.method==='GET'?{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')}:request.method==='POST'?await request.json():null;
    if(!b)return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    if(request.method==='POST'&&b.confirm!=='SAVE_PROVISIONAL')throw Error('confirm SAVE_PROVISIONAL is required');
    const result=request.method==='GET'?await readProvisionalPrediction(env.DB,b):await saveProvisionalPrediction(env.DB,b,async()=>{const source=await resolveExpectedCollectionSource(env.DB,b);if(!source)throw Error('想定名簿が未保存です。');const repair=await repairStoredProgramConditions(env.DB,source);return {...await provisionalExpectedPrediction(env.DB,source),programRepair:repair};});
    return Response.json({...result,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers});}
  }

  if(u.pathname==='/v1/lab/provisional-prediction'&&request.method==='GET'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   try{const source=await resolveExpectedCollectionSource(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});return Response.json({...await provisionalExpectedPrediction(env.DB,source),version:VERSION},{headers});}
   catch(e){return Response.json({ok:false,status:'provisional-unavailable',error:String(e.message||e)},{status:409,headers});}
  }

  if(u.pathname==='/v1/lab/automatic-prediction'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    let result;
    if(request.method==='GET')result=await readAutomaticPrediction(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});
    else if(request.method==='POST'){const b=await request.json();if(b.confirm!=='CAPTURE')throw Error('confirm CAPTURE is required');result=await captureAutomaticPrediction(env.DB,b);}
    else return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    return Response.json({...result,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers})}
  }

  if(u.pathname==='/v1/lab/automatic-shadow-training'){
   const headers={'cache-control':'no-store'};
   if(!['GET','POST'].includes(request.method))return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
   if(typeof env.USER_MARK_WRITE_TOKEN!=='string'||env.USER_MARK_WRITE_TOKEN.length<24||request.headers.get('authorization')!=='Bearer '+env.USER_MARK_WRITE_TOKEN)return Response.json({ok:false,error:'authorized operator required'},{status:401,headers});
   try{
    if(request.method==='GET')return Response.json({...await readAutomaticTraining(env.DB,u.searchParams.get('sha256')),version:VERSION},{headers});
    const text=await request.text();if(text.length>16384)throw Error('入力サイズ上限です。');const input=JSON.parse(text);if(input.confirm!=='TRAIN')throw Error('confirm TRAIN が必要です。');validateAutomaticTrainingInput(input);
    const result=await runWithScheduledReadBudget(env.DB,db=>trainAutomaticReferences(db,input),Date.now,'learning');
    return Response.json({...result,version:VERSION},{headers,status:result.status==='paused'?503:200});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers});}
  }
  if(u.pathname==='/v1/lab/automatic-shadow-validation'){
   const headers={'cache-control':'no-store'};
   if(!['GET','POST'].includes(request.method))return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
   if(typeof env.USER_MARK_WRITE_TOKEN!=='string'||env.USER_MARK_WRITE_TOKEN.length<24||request.headers.get('authorization')!=='Bearer '+env.USER_MARK_WRITE_TOKEN)return Response.json({ok:false,error:'authorized operator required'},{status:401,headers});
   try{
    if(request.method==='GET')return Response.json({...await readAutomaticValidation(env.DB,u.searchParams.get('sha256')),version:VERSION},{headers});
    const text=await request.text();if(text.length>16384)throw Error('入力サイズ上限です。');const input=JSON.parse(text);if(input.confirm!=='VALIDATE')throw Error('confirm VALIDATE が必要です。');validateAutomaticValidationInput(input);
    const result=await runWithScheduledReadBudget(env.DB,db=>validateAutomaticReferences(db,input),Date.now,'learning');
    return Response.json({...result,version:VERSION},{headers,status:result.status==='paused'?503:200});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers});}
  }
  if(u.pathname==='/v1/lab/saved-reference-training'){
   try{
    const result=request.method==='GET'?await readSavedReferenceTraining(env.DB,u.searchParams.get('sha256')):request.method==='POST'?await (async()=>{const b=await request.json();if(b.confirm!=='TRAIN')throw Error('confirm TRAIN が必要です。');return trainSavedReferences(env.DB,b);})():null;
    return Response.json(result?{...result,version:VERSION}:{ok:false,error:'method not allowed'},{status:result?200:405,headers:{'cache-control':'no-store'}});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409});}
  }
  if(u.pathname==='/v1/lab/expected-roster-seed-import'&&request.method==='POST'){
   try{const input=await request.json();if(input.confirm!=='IMPORT_BUNDLED')throw Error('confirm IMPORT_BUNDLED is required');return Response.json({...await importExpectedRosterSeed(env.DB,input.snapshotId),version:VERSION},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:400})}
  }
  if(u.pathname==='/v1/lab/expected-roster-ingest'&&request.method==='POST'){
   if(!env.USER_MARK_WRITE_TOKEN||request.headers.get('authorization')!==`Bearer ${env.USER_MARK_WRITE_TOKEN}`)return Response.json({ok:false,error:'write authorization required'},{status:401});
   try{const input=await request.json();if(input.confirm!=='SAVE')throw Error('confirm SAVE is required');return Response.json({...await saveExpectedRoster(env.DB,input),version:VERSION},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({ok:false,error:String(e.message||e),...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:400})}
  }
  if(u.pathname==='/v1/lab/week-data-inventory'&&request.method==='GET'){
   try{return Response.json({...await weekDataInventory(env.DB,{from:u.searchParams.get('from'),to:u.searchParams.get('to')}),version:VERSION},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({ok:false,error:String(e.message||e)},{status:400})}
  }
  if(u.pathname==='/v1/lab/saved-pre-race-assessment'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    if(request.method==='GET')return Response.json({...await readSavedPreRaceAssessment(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no'),phase:u.searchParams.get('phase')||'final'}),version:VERSION},{headers});
    if(request.method!=='POST')return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    const input=await request.json();if(!['PRESERVE','LABEL'].includes(input.confirm))throw Error('confirm PRESERVE または LABEL が必要です。');const result=input.confirm==='LABEL'?await labelSavedPreRaceAssessment(env.DB,input):await preserveSavedPreRaceAssessment(env.DB,input);return Response.json({...result,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION,...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:409,headers});}
  }
  if(['/v1/lab/post-race-assessment','/lab/post-race-assessment'].includes(u.pathname)){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    if(request.method==='POST'&&u.pathname.startsWith('/v1/')){const input=await request.json();if(input.confirm!=='CAPTURE')throw Error('confirm CAPTURE が必要です。');return Response.json({...await capturePostRaceAssessment(env.DB,input),version:VERSION},{headers});}
    if(request.method!=='GET')return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    const records=await readPostRaceAssessments(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});
    return u.pathname.startsWith('/lab/')?new Response(postRaceAssessmentPage(records),{headers:{...headers,'content-type':'text/html; charset=utf-8'}}):Response.json({ok:true,records,version:VERSION,eligibleForProspectiveAccuracy:false},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION,...(e.saveMayHaveSucceeded?{saveMayHaveSucceeded:true,retryWrite:false}:{})},{status:e.saveMayHaveSucceeded?503:400,headers});}
  }
  if(u.pathname==='/v1/lab/missing-official-cards'||u.pathname==='/v1/lab/missing-official-card-batch'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   try{
    if(request.method==='GET'&&u.pathname.endsWith('cards'))return Response.json({...await missingOfficialCards(env.DB,u.searchParams.get('date')),version:VERSION},{headers});
    if(request.method!=='POST'||!u.pathname.endsWith('batch'))return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    const b=await request.json();if(b.confirm!=='COLLECT')throw Error('confirm COLLECT が必要です。');
    return Response.json({...await runPipelineJob(env.DB,'history','manual',()=>collectMissingOfficialCard(env.DB,b)),version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:400,headers});}
  }
  if(u.pathname==='/v1/lab/deploy-check'&&request.method==='GET')return Response.json({ok:true,version:VERSION,build:'verified-user-mark-persistence',now:new Date().toISOString()},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  const statusKey=statusCacheKey(request),statusCache=globalThis.caches?.default;
  const cachedStatus=await readStatusCache(statusCache,statusKey);if(cachedStatus)return cachedStatus;
  if(u.pathname==='/lab/learning-source-track'&&request.method==='GET')return new Response(learningSourceTrackPage(),{headers:{'cache-control':'no-store','content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff'}});
  if(['/v1/lab/learning-source-track','/v1/lab/learning-source-track-capture'].includes(u.pathname)){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    if(u.pathname.endsWith('-capture')){if(request.method!=='POST')return Response.json({ok:false,error:'method not allowed',version:VERSION},{status:405,headers});const input=await request.json();if(input.confirm!=='CAPTURE')throw Error('confirm CAPTURE が必要です。');const result=await captureSourceTrackRace(env.DB,input);try{await statusCache?.delete(new Request(new URL('/v1/lab/learning-source-track',u.origin).toString(),{method:'GET'}))}catch{}return Response.json({...result,version:VERSION},{headers})}
    if(request.method!=='GET')return Response.json({ok:false,error:'method not allowed',version:VERSION},{status:405,headers});
    const response=Response.json({...await sourceTrackStatus(env.DB),version:VERSION},{headers});
    if(statusKey)await writeStatusCache(statusCache,statusKey,response);
    return response;
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:400,headers})}
  }
  if(u.pathname==='/v1/lab/upcoming-history-plan'&&request.method==='GET'){
   try{return Response.json({ok:true,version:VERSION,races:await upcomingOfficialHistoryPlan(env.DB),horizonDays:7,scope:'stored-official-cards',externalRequests:0},{headers:{'cache-control':'no-store'}});}catch{return Response.json({ok:false,version:VERSION,error:'収集予定を確認できません。'},{status:503});}
  }
  if(['/v1/lab/race-reference-notes','/lab/race-reference-notes'].includes(u.pathname)){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
   if(request.method!=='GET')return Response.json({ok:false,error:'read-only endpoint',version:VERSION},{status:405,headers});
   try{const data=await readEditorialReferences(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});return u.pathname.startsWith('/v1/')?Response.json({...data,version:VERSION},{headers}):new Response(editorialReferencePage(data),{headers:{...headers,'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff'}});}catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:/登録がない/.test(String(e))?404:/照合できません/.test(String(e))?409:503,headers});}
  }
  if(u.pathname==='/v1/lab/collection-read-policy'&&request.method==='GET')return Response.json({ok:true,version:VERSION,policy:COLLECTION_READ_POLICY},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  if(u.pathname==='/v1/lab/scheduled-read-budget'&&request.method==='GET'){
   try{return Response.json({ok:true,version:VERSION,budget:await scheduledReadStatus(env.DB)},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});}catch{return Response.json({ok:false,version:VERSION,error:'DB読み取り予算を確認できません。定期処理は予算確認に成功するまで実行しません。'},{status:503,headers:{'cache-control':'no-store'}});}
  }
  if(u.pathname==='/v1/lab/prior-result-details'){
   const headers={'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   try{
    let data;
    if(request.method==='GET')data=await priorDetailStatus(env.DB,{date:u.searchParams.get('date'),venue:u.searchParams.get('venue'),raceNo:u.searchParams.get('race_no')});
    else if(request.method==='POST'){
     const input=await request.json();if(input.confirm!=='COLLECT')throw Error('confirm COLLECT が必要です。');
     data=await runPipelineJob(env.DB,'prior-details','manual',()=>collectPriorDetails(env.DB,input));
    }else return Response.json({ok:false,error:'method not allowed'},{status:405,headers});
    return Response.json({...data,version:VERSION},{headers});
   }catch(e){return Response.json({ok:false,error:String(e.message||e),version:VERSION},{status:400,headers})}
  }
  if(u.pathname==='/v1/lab/locked-mark-results'&&request.method==='GET'){
   const date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),no=Number(u.searchParams.get('race_no')),phase=u.searchParams.get('phase');
   const valid=/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&venue&&venue.length<=30&&Number.isInteger(no)&&no>=1&&no<=12&&['final','post_draw'].includes(phase);
   try{return Response.json(valid?{ok:true,version:VERSION,evidence:await readLockedMarkResults(env.DB,date+':'+venue+':'+no,phase)}:{ok:false,error:'invalid race',version:VERSION},{status:valid?200:400,headers:{'cache-control':'no-store'}})}catch{return Response.json({ok:false,error:'evidence integrity unverified',version:VERSION},{status:409})}
  }
  if(u.pathname==='/v1/lab/user-mark-lock'){const r=await userMarkLockEndpoint(request,env);return new Response(JSON.stringify({...await r.json(),version:VERSION}),{status:r.status,headers:r.headers});}
  if(u.pathname==='/v1/lab/user-mark-token-check'&&request.method==='GET'){
   const ready=typeof env.USER_MARK_WRITE_TOKEN==='string'&&env.USER_MARK_WRITE_TOKEN.length>=24;
   const tokenMatch=ready&&request.headers.get('authorization')===`Bearer ${env.USER_MARK_WRITE_TOKEN}`;
   return new Response(JSON.stringify({ok:tokenMatch,tokenMatch,writeReady:ready,mode:'no-write',version:VERSION}),{
    status:!ready?503:tokenMatch?200:401,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
   });
  }
  if(u.pathname==='/v1/lab/workouts'||u.pathname==='/v1/lab/workouts/sync'){
   const response=await workoutEndpoint(request,env);
   const data=await response.json();
   return new Response(JSON.stringify({...data,version:VERSION}),{status:response.status,headers:response.headers});
  }
  const response=await app.fetch(request,env,ctx);
  let data;try{data=await response.clone().json();}catch{return response;}
  if(data&&typeof data==='object'){data.version=VERSION;if(u.pathname==='/v1/lab/work-progress'){data.readPolicy=COLLECTION_READ_POLICY;try{data.scheduledReadBudget=await scheduledReadStatus(env.DB);}catch{data.scheduledReadBudget=null;}}}
  if(response.ok&&request.method==='GET'&&u.pathname==='/v1/lab/user-marks'&&Array.isArray(data?.latest)){
   for(const revision of data.latest){
    try{
     const stored=await env.DB.prepare('SELECT audit_json,audit_sha256,created_at FROM lab_user_mark_revisions WHERE revision_id=? AND race_key=? AND phase=?').bind(revision.revisionId,data.raceKey,revision.phase).first();
     revision.userLock=['post_draw','final'].includes(revision.phase)?await readUserMarkLock(env.DB,data.raceKey,revision.phase):null;
     revision.provenance=await markRecordProvenance({...revision,createdAt:stored?.created_at,auditJson:stored?.audit_json,auditSha256:stored?.audit_sha256},u.searchParams.get('date'),revision.userLock);
    }catch{
     revision.provenance={status:'provenance-unavailable',integrityVerified:false,recordedBeforeRaceDay:false,preRaceLock:false,validationCreditEligible:false};
    }
   }
  }
  const finalResponse=new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
  if(statusKey)await writeStatusCache(statusCache,statusKey,finalResponse);
  return finalResponse;
 },
 async scheduled(event,env,ctx){
  if(!shouldRunScheduled(event))return;
  return runWithScheduledReadBudget(env.DB,async db=>{
  const budgetEnv={...env,DB:db};
  if(event.cron==='*/3 * * * *'){
   try{await scheduledAutomaticPrediction(db);}catch(e){console.error('automatic-prediction',String(e));}
   await dispatchLiveSources(event,budgetEnv);
   await collectLockedMarkResults(db);
   try{await scheduledAutomaticCandidates(db);}catch(e){console.error('automatic-learning-candidate',String(e));}
   return;
  }
  if(event.cron==='0 * * * *')await recoverOldAutomaticPrediction(db);
  try{await seedEditorialReferences(db);await verifyEditorialClaims(db);}catch{console.warn('editorial reference seed unavailable');}
  await app.scheduled(event,budgetEnv,ctx);
  await collectLockedMarkResults(db);
  },Date.now,scheduledBudgetLane(event));
 }
};
