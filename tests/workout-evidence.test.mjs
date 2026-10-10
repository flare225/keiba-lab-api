import test from 'node:test';
import assert from 'node:assert/strict';
import app,{VERSION} from '../src/index-v3.49.0.js';
import {workoutTarget,normalizeWorkoutBatch,getWorkoutEvidence,syncWorkoutEvidence,workoutEndpoint} from '../src/workout-evidence-v3.49.0.js';
const target={date:'2026-10-11',venue:'東京',raceNo:11,raceKey:'2026-10-11:東京:11'};
const official=[{horse_no:1,frame_no:1,horse_name:'ワーク馬A'},{horse_no:2,frame_no:2,horse_name:'ワーク馬B'}];
function db(rows=[]){
 const executed=[],exec={run:false,batches:[]};
 return {executed,exec,prepare(sql){const q={args:[],bind(...args){q.args=args;return q;},async first(){executed.push({sql,args:q.args});return /FROM jra_races/.test(sql)?{race_key:target.raceKey,race_name:'アイルランドトロフィー',runner_count:2}:null;},async all(){executed.push({sql,args:q.args});return {results:/FROM jra_runners/.test(sql)?official:/FROM lab_workout_evidence/.test(sql)?rows:[]};},async run(){exec.run=true;return {success:true};}};return q;},async batch(stmts){exec.batches.push(stmts);return stmts.map(()=>({success:true}));}};
}
const source={rightsGranted:true,sourceName:'Licensed Test Provider',sourceRecordId:'evidence-123',workouts:[{horseNo:1,horseName:'ワーク馬A',workoutDate:'2026-10-08',course:'坂路',fourF:52.1,lastF:12.8}]};
test('workout ingestion rejects unknown official horses, after-race workouts, non-licensed feeds, invalid times and duplicates',()=>{
 assert.equal(workoutTarget(target).raceKey,target.raceKey);
 assert.throws(()=>workoutTarget({date:'2026-10-11',venue:'東京',raceNo:0}),/番号/);
 const rows=normalizeWorkoutBatch(source,target,official);
 assert.equal(rows.length,1);assert.equal(rows[0].horseNo,1);assert.equal(rows[0].fourF,52.1);
 const mutate=alter=>({...source,workouts:[{...source.workouts[0],...alter}]});
 assert.throws(()=>normalizeWorkoutBatch({...source,rightsGranted:false},target,official),/許諾/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({horseNo:11}),target,official),/正式出走馬/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({horseName:'別の馬'}),target,official),/一致/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({workoutDate:'2026-10-11'}),target,official),/レース前/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({workoutDate:'2026-08-01'}),target,official),/レース前/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({course:'未知'}),target,official),/調教種別/);
 assert.throws(()=>normalizeWorkoutBatch(mutate({fourF:12,lastF:14}),target,official),/整合/);
 assert.throws(()=>normalizeWorkoutBatch({...source,workouts:[source.workouts[0],source.workouts[0]]},target,official),/重複/);
});
test('GET without sourced workouts shows two official horses and an honest uncollected status',async()=>{
 const d=db(),info=await getWorkoutEvidence(d,target,{});
 assert.equal(info.ok,true);assert.equal(info.stage,'not-collected');
 assert.equal(info.coverage.official,2);assert.equal(info.coverage.withWorkout,0);
 assert.equal(info.collectionConfigured,false);assert.equal(info.modelIncorporated,false);
 assert.equal(info.runners[0].workouts.length,0);
});
test('stored rows are only tied to the matching official horse and never alter the prediction score',async()=>{
 const d=db([
 {horse_no:1,horse_name:'ワーク馬A',workout_date:'2026-10-08',course:'坂路',four_f:52,last_f:12.7,source_name:'Permitted',source_record_id:'id-1',imported_at:'2026-10-08T00:00:00Z'},
 {horse_no:2,horse_name:'wrong',workout_date:'2026-10-08',course:'坂路',four_f:50,last_f:11,source_name:'Permitted',imported_at:'2026-10-08T00:00:00Z'}]);
 const result=await getWorkoutEvidence(d,target,{WORKOUT_LICENSE_CONFIRMED:'yes',WORKOUT_FEED_URL:'https://provider.example/feed'});
 assert.equal(result.stage,'stored');assert.equal(result.coverage.withWorkout,1);
 assert.equal(result.runners[0].workouts[0].fourF,52);
 assert.equal(result.runners[1].state,'unavailable');
 assert.equal(result.modelIncorporated,false);
});
test('only configured and licensed feed sync writes, never anonymous unauthenticated POST',async()=>{
 const d=db(),config={WORKOUT_LICENSE_CONFIRMED:'yes',WORKOUT_FEED_URL:'https://licensed.example/api/workouts',WORKOUT_FEED_TOKEN:'feed-secret'};
 let observed;
 const fetcher=async(url,options)=>{observed={url,options};return new Response(JSON.stringify(source),{status:200,headers:{'content-type':'application/json'}});};
 const outcome=await syncWorkoutEvidence(d,config,target,fetcher);
 assert.equal(outcome.stored,1);assert.equal(d.exec.batches.length,1);
 assert.match(observed.url,/race_no=11/);assert.match(observed.options.headers.authorization,/feed-secret/);
 assert.equal(outcome.modelIncorporated,false);
 await assert.rejects(()=>syncWorkoutEvidence(d,{...config,WORKOUT_LICENSE_CONFIRMED:'no'},target,fetcher),/未設定/);
 await assert.rejects(()=>syncWorkoutEvidence(d,{...config,WORKOUT_FEED_URL:'http://127.0.0.1/private'},target,fetcher),/URL/);
 const unauth=await workoutEndpoint(new Request('https://test/v1/lab/workouts/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...target,confirm:'SYNC'})}),{DB:d,...config,WORKOUT_SYNC_TOKEN:'private'});
 assert.equal(unauth.status,403);assert.equal(d.exec.batches.length,1);
});
test('production entrypoint surfaces workout status without a configured provider',async()=>{
 const d=db(),r=await app.fetch(new Request('https://lab.test/v1/lab/workouts?date=2026-10-11&venue=%E6%9D%B1%E4%BA%AC&race_no=11'),{DB:d});
 const data=await r.json();
 assert.equal(r.status,200);assert.equal(data.version,VERSION);
 assert.equal(data.coverage.withWorkout,0);
 assert.equal(data.modelIncorporated,false);
});

test('API deploy-check reports active workout release, not the inherited older backend version',async()=>{
 const response=await app.fetch(new Request('https://lab.test/v1/lab/deploy-check'),{});
 const data=await response.json();
 assert.equal(data.ok,true);
 assert.equal(data.version,VERSION);
 assert.equal(VERSION,'3.49.0');
});
