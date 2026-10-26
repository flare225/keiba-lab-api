import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {prepareReviewedRoster} from '../src/expected-roster-seeds.js';
import {UPCOMING_REVIEWED_ROSTERS} from '../src/upcoming-reviewed-rosters.js';
import {scheduledProvisionalPrediction} from '../src/provisional-prediction-queue.js';
import {buildProvisionalPrediction} from '../src/provisional-expected-prediction.js';
import {readProvisionalPrediction} from '../src/provisional-prediction-snapshots.js';
import {sha256} from '../src/card-evidence.js';import app from '../src/index-v3.49.0.js';
const now=Date.parse('2026-10-26T08:00:00Z');
function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];return {sql,queries,db:{prepare(q){const w=(a=[])=>({bind(...v){return w(v)},async first(){queries.push(q);return sql.prepare(q).get(...a)||null},async all(){queries.push(q);return{results:sql.prepare(q).all(...a)}},async run(){queries.push(q);return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return w()}}};}
test('reviewed real candidates from both providers independently read back without history or refetch',async()=>{
 const {db,sql,queries}=fixture();
 for(let i=0;i<UPCOMING_REVIEWED_ROSTERS.length;i++){
  const r=await prepareReviewedRoster(db,'2026-10-27','2026-11-02',now+i*3600000,UPCOMING_REVIEWED_ROSTERS),seed=UPCOMING_REVIEWED_ROSTERS.find(s=>`${s.record.date}:${s.record.venue}:${s.record.raceNo}`===r.target),t=seed.record;
  assert.equal(r.saved,1);assert.equal(r.storedRunners,t.runners.length);assert.equal(r.externalRequests,0);assert.equal(r.entriesConfirmed,false);assert.equal(r.candidateSetComplete,null);
  const stored=sql.prepare('SELECT * FROM lab_expected_roster_registry WHERE snapshot_id=?').get(r.snapshotId);assert.equal(await sha256(stored.record_json),r.snapshotId);const body=JSON.parse(stored.record_json);assert.match(body.sourceText,/全登録馬を網羅する名簿ではなく/);assert.deepEqual(body.runners,t.runners);assert.equal(body.provider,t.provider);assert.equal(body.kind,'expected-runners');
  const response=await app.fetch(new Request('https://test/v1/lab/expected-runners?'+new URLSearchParams({date:t.date,venue:t.venue,race_no:String(t.raceNo)})),{DB:db},{}),read=await response.json();assert.equal(response.status,200);assert.equal(read.source.snapshotId,'registered:'+r.snapshotId);assert.equal(read.runners.length,t.runners.length);assert.ok(read.runners.every(x=>x.horseNo===null&&x.frameNo===null));
 }
 const before=sql.prepare('SELECT * FROM lab_expected_roster_registry ORDER BY snapshot_id').all();queries.length=0;const again=await prepareReviewedRoster(db,'2026-10-27','2026-11-02',now+3*3600000,UPCOMING_REVIEWED_ROSTERS);assert.equal(again.saved,0);assert.equal(queries.length,1);assert.match(queries[0],/^SELECT snapshot_id/);assert.deepEqual(sql.prepare('SELECT * FROM lab_expected_roster_registry ORDER BY snapshot_id').all(),before);assert.throws(()=>sql.exec("UPDATE lab_expected_roster_registry SET stored_at='changed'"),/immutable/);sql.close();
});
test('existing hourly queue preserves imported candidate roster even when ordinary-race evaluation lacks history',async()=>{
 const {db,sql}=fixture();const result=await scheduledProvisionalPrediction(db,now,{prepareRoster:(d,f,t,s)=>prepareReviewedRoster(d,f,t,s,UPCOMING_REVIEWED_ROSTERS),repair:async()=>({repaired:0}),build:async()=>({scoredRunners:0})});
 assert.equal(result.status,'awaiting-data');assert.equal(result.rosterPreparation.saved,1);assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_roster_registry').get().n,1);assert.equal(result.externalRequests,0);const again=await scheduledProvisionalPrediction(db,now+1000);assert.equal(again.status,'not-due');sql.close();
});
test('official-program debut can persist all-held evaluation without inventing score, rank, marks or formal LOCK',async()=>{
 const {db,sql}=fixture(),source={date:'2026-10-31',venue:'京都',raceNo:5,raceName:'2歳新馬',snapshotId:'isolated-debut',names:['合成候補'],provider:'JRA',kind:'expected-runners'},conditions={surface:'芝',distance:2000,race_label:'2歳新馬 2000(芝)',source_url:'https://www.jra.go.jp/keiba/calendar2026/2026/10/1031.html'};
 const result=await scheduledProvisionalPrediction(db,now,{prepareRoster:async()=>({saved:0}),sources:async()=>[source],repair:async()=>({repaired:0}),build:async()=>buildProvisionalPrediction(source,conditions,new Map(),now)});
 assert.equal(result.saved,1);assert.equal(result.evaluationStatus,'roster-saved-evaluation-held');const read=await readProvisionalPrediction(db,source);assert.equal(read.snapshotSha256,result.snapshotSha256);assert.equal(read.snapshot.scoredRunners,0);assert.ok(read.snapshot.runners.every(x=>x.rank===null&&x.score===null&&x.mark===null));assert.equal(read.snapshot.guardrails.locked,false);assert.equal(read.snapshot.guardrails.eligibleForLearning,false);assert.equal(read.snapshot.preparation.entriesConfirmed,false);
 assert.equal(buildProvisionalPrediction(source,{...conditions,source_url:'https://other.invalid/'},new Map(),now).race.raceType,undefined);sql.close();
});
