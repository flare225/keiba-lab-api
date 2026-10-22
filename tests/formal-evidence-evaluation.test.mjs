import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildFormalComparison,saveFormalComparison,FORMAL_COMPARISON_MODEL} from '../src/formal-evidence-evaluation.js';
import {readEvidenceEvaluation} from '../src/evidence-evaluation-snapshots.js';
import {sha256} from '../src/card-evidence.js';
import {scheduledEvidenceEvaluation} from '../src/evidence-evaluation-queue.js';
import {scheduledFormalComparison} from '../src/formal-evidence-evaluation.js';
const t={date:'2026-10-25',venue:'京都',raceNo:11},now=Date.parse('2026-10-22T11:00:00Z');
function source(){
 const runners=Array.from({length:18},(_,i)=>({horse_no:i+1,horse_name:'horse'+(i+1),frame_no:Math.min(8,1+Math.floor(i/2)),age:3}));
 const card={raceKey:'official-card-key',...t,surface:'芝',distance:3000,startTime:'15:40',runners};
 const baseline={ok:true,available:true,integrityVerified:true,snapshotSha256:'verified-formal-baseline-sha',snapshot:{race:{...t,raceKey:'2026-10-25:京都:11',storedCardKey:card.raceKey,runnerCount:18},savedAt:new Date(now-1000).toISOString(),modelVersion:'existing-safe-core-1.5-recent-three-v1',card:runners,
 runners:runners.map(r=>({horseName:r.horse_name,horseNo:r.horse_no,rank:r.horse_no,score:100-r.horse_no,mark:r.horse_no===1?'◎':null})),histories:runners.map(r=>({horseName:r.horse_name,available:true,warnings:[],recent:[{date:'2026-09-01',venue:'京都',surface:'芝',distance:3000,finish:r.horse_no,fieldSize:18,last3f:35}]})),guardrails:{immutable:true,humanMarksUsed:false,targetResultUsed:false}}};
 return{baseline,card};
}
function dbFixture(){const sql=new DatabaseSync(':memory:');let fail=false,inserts=0;const db={prepare(q){const wrap=(a=[])=>({bind(...v){return wrap(v)},async all(){return{results:sql.prepare(q).all(...a)}},async run(){if(q.startsWith('INSERT'))inserts++;return{meta:{changes:sql.prepare(q).run(...a).changes}}},async first(){if(fail&&q.startsWith('SELECT *'))throw Error('isolated readback loss');return sql.prepare(q).get(...a)||null}});return wrap()}};return{db,sql,setFail(x){fail=x},inserts:()=>inserts};}
test('formal adapter uses 18 numbered baseline runners and preserves model separation',async()=>{
 const data=source(),before=JSON.stringify(data),s=await buildFormalComparison(data.baseline,data.card,now);
 assert.equal(s.runners.length,18);assert.equal(s.modelVersion,FORMAL_COMPARISON_MODEL);assert.equal(s.scoringPolicyVersion,'course-position-shadow-v1');assert.equal(s.rosterBasis,'official-card');assert.equal(s.runners[17].horseNo,18);assert.equal(s.runners[17].frameNo,8);assert.equal(s.guardrails.formalLock,false);assert.equal(s.guardrails.eligibleForLearning,false);assert.equal(s.guardrails.automaticPromotion,false);assert.equal(JSON.stringify(data),before);
});
test('old 21 snapshot stays immutable while formal 18 saves, reads independently and deduplicates',async()=>{
 const a=dbFixture(),data=source(),load=async()=>data;
 const first=await saveFormalComparison(a.db,t,now,load);
 const old={...first.snapshot,modelVersion:'course-position-shadow-v1',sourceFingerprint:'old21',runners:[...first.snapshot.runners,...first.snapshot.runners.slice(0,3)]},body=JSON.stringify(old),hash=await sha256(body);
 a.sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?,?,?,?,?)').run(hash,'2026-10-25:京都:11',old.modelVersion,old.sourceFingerprint,body,old.savedAt);
 const read=await readEvidenceEvaluation(a.db,{...t,sha256:first.snapshotSha256});assert.equal(read.snapshot.runners.length,18);assert.deepEqual(read.snapshot,first.snapshot);
 const again=await saveFormalComparison(a.db,t,now+1000,load);assert.equal(again.saved,0);assert.equal(again.snapshotSha256,first.snapshotSha256);assert.equal(again.snapshot.savedAt,first.snapshot.savedAt);
 const prior=await readEvidenceEvaluation(a.db,{...t,sha256:hash});assert.equal(prior.snapshot.runners.length,21);assert.equal(JSON.stringify(prior.snapshot),body);assert.equal(a.sql.prepare('SELECT COUNT(*) n FROM lab_evidence_evaluations_v1').get().n,2);
 assert.throws(()=>a.sql.exec('UPDATE lab_evidence_evaluations_v1 SET saved_at=\'changed\''),/immutable/);assert.throws(()=>a.sql.exec('DELETE FROM lab_evidence_evaluations_v1'),/immutable/);a.sql.close();
});
test('formal mismatch, unverified baseline, deadline and old 21 pool reject before writes',async()=>{
 for(const mutate of [x=>x.baseline.integrityVerified=false,x=>x.card.runners[0].frame_no=0,x=>x.card.runners[0].horse_name='other',x=>x.card.raceNo=10,x=>x.baseline.snapshot.race.runnerCount=21,x=>x.baseline.snapshot.savedAt=new Date(now+1).toISOString()]){const data=source();mutate(data);await assert.rejects(buildFormalComparison(data.baseline,data.card,now));}
 const data=source();await assert.rejects(buildFormalComparison(data.baseline,data.card,Date.parse('2026-10-25T15:35:00+09:00')),/deadline/);
});
test('INSERT uncertainty reads saved formal version before retry and never overwrites old rows',async()=>{
 const a=dbFixture(),data=source(),load=async()=>data;a.setFail(true);await assert.rejects(saveFormalComparison(a.db,t,now,load),e=>e.saveMayHaveSucceeded===true);assert.equal(a.inserts(),1);a.setFail(false);
 const read=await readEvidenceEvaluation(a.db,t),again=await saveFormalComparison(a.db,t,now+1000,load);assert.equal(again.saved,0);assert.equal(again.snapshotSha256,read.snapshotSha256);assert.equal(a.inserts(),1);a.sql.close();
});
test('a loader returning another race cannot write an incorrectly keyed comparison',async()=>{
 let calls=0;const db={prepare(){calls++;throw Error('no DB access allowed')}};
 await assert.rejects(saveFormalComparison(db,{...t,raceNo:10},now,async()=>source()),/target mismatch/);assert.equal(calls,0);
});
async function queuedFixture(){const a=dbFixture(),data=source();a.sql.exec('CREATE TABLE lab_automatic_predictions_v1(race_key TEXT,race_date TEXT,snapshot_json TEXT,snapshot_sha256 TEXT);CREATE TABLE jra_races(race_date TEXT,venue TEXT,race_no INTEGER,runner_count INTEGER);CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT);CREATE TABLE lab_evidence_evaluations_v1(evaluation_sha256 TEXT PRIMARY KEY,race_key TEXT,model_version TEXT,source_fingerprint TEXT,snapshot_json TEXT,saved_at TEXT,UNIQUE(race_key,model_version,source_fingerprint))');
 a.sql.prepare('INSERT INTO lab_automatic_predictions_v1 VALUES(?,?,?,?)').run('2026-10-25:京都:11',t.date,JSON.stringify(data.baseline.snapshot),data.baseline.snapshotSha256);a.sql.prepare('INSERT INTO jra_races VALUES(?,?,?,?)').run(t.date,t.venue,11,18);a.sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?)').run(t.date,t.venue,11,'15:40');
 const old={...await buildFormalComparison(data.baseline,data.card,now),modelVersion:'course-position-shadow-v1',sourceFingerprint:'old21',runners:Array.from({length:21},(_,i)=>({horseName:'old'+i})),savedAt:new Date(now+3000).toISOString()},body=JSON.stringify(old),hash=await sha256(body);a.sql.prepare('INSERT INTO lab_evidence_evaluations_v1 VALUES(?,?,?,?,?,?)').run(hash,'2026-10-25:京都:11',old.modelVersion,old.sourceFingerprint,body,old.savedAt);return{...a,data,oldHash:hash,oldBody:body};}
test('natural comparison shares hourly clock, stores formal 18 despite old 21 and GET prefers formal',async()=>{
 const a=await queuedFixture(),deps={formal:(db,n)=>scheduledFormalComparison(db,n,{save:(db,t,n)=>saveFormalComparison(db,t,n,async()=>a.data)})};
 const first=await scheduledEvidenceEvaluation(a.db,now,deps);assert.equal(first.saved,1);assert.equal(first.runnerCount,18);assert.equal(first.rosterBasis,'official-card');assert.equal((await scheduledEvidenceEvaluation(a.db,now+1,deps)).status,'not-due');
 const latest=await readEvidenceEvaluation(a.db,t);assert.equal(latest.snapshot.modelVersion,FORMAL_COMPARISON_MODEL);assert.equal((await readEvidenceEvaluation(a.db,{...t,sha256:a.oldHash})).snapshot.runners.length,21);assert.equal(a.sql.prepare('SELECT snapshot_json FROM lab_evidence_evaluations_v1 WHERE evaluation_sha256=?').get(a.oldHash).snapshot_json,a.oldBody);assert.equal((await scheduledEvidenceEvaluation(a.db,now+3600000,deps)).status,'no-due-comparison');assert.equal(a.sql.prepare('SELECT COUNT(*) n FROM lab_evidence_evaluations_v1').get().n,2);a.sql.close();
});
test('formal natural lane recovers stored row after lost readback without regenerating',async()=>{
 const a=await queuedFixture();let saves=0;a.setFail(true);const deps={formal:(db,n)=>scheduledFormalComparison(db,n,{save:async(db,t,n)=>{saves++;return saveFormalComparison(db,t,n,async()=>a.data)}})};
 assert.equal((await scheduledEvidenceEvaluation(a.db,now,deps)).status,'pending-readback');a.setFail(false);deps.formal=(db,n)=>scheduledFormalComparison(db,n,{save:()=>assert.fail('must not regenerate')});const next=await scheduledEvidenceEvaluation(a.db,now+7200000,deps);assert.equal(next.status,'verified');assert.equal(next.saved,0);assert.equal(saves,1);a.sql.close();
});
test('formal lane quota failure propagates without a retry receipt write',async()=>{
 const a=await queuedFixture();await assert.rejects(scheduledEvidenceEvaluation(a.db,now,{formal:(db,n)=>scheduledFormalComparison(db,n,{save:()=>{throw Object.assign(Error('quota'),{d1DailyReadLimit:true})}})}),e=>e.d1DailyReadLimit);assert.equal(a.sql.prepare('SELECT status FROM lab_evidence_queue_v1 WHERE model_version=?').get(FORMAL_COMPARISON_MODEL).status,'pending-readback');a.sql.close();
});
