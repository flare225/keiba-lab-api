import test from 'node:test';
import assert from 'node:assert/strict';
import {markRecordProvenance} from '../src/mark-record-provenance.js';
import {sha256} from '../src/card-evidence.js';
async function revision(stamp='2026-10-10T14:59:59.000Z'){
 const auditJson=JSON.stringify({race:{date:'2026-10-11'},phase:'final',audit:{marked:[{horseNo:1,horseName:'TEST',mark:'◎',note:null}]}});
 return {createdAt:stamp,phase:'final',auditJson,auditSha256:await sha256(auditJson),entries:[{horse_no:1,horse_name:'TEST',mark:'◎',note:null,ordinal:1}]};
}
test('prior-day immutable record proves timing but never grants a LOCK or validation credit',async()=>{
 const r=await markRecordProvenance(await revision(),'2026-10-11');
 assert.equal(r.status,'verified-prior-day-record');assert.equal(r.integrityVerified,true);
 assert.equal(r.recordedBeforeRaceDay,true);assert.equal(r.preRaceLock,false);assert.equal(r.validationCreditEligible,false);
});
test('JST midnight requires race-day time verification even without stored outcomes',async()=>{
 const r=await markRecordProvenance(await revision('2026-10-10T15:00:00.000Z'),'2026-10-11');
 assert.equal(r.status,'race-day-time-unverified');assert.equal(r.recordedBeforeRaceDay,false);
});
test('Oct13 save of Oct11 race is retrospective',async()=>{
 const r=await markRecordProvenance(await revision('2026-10-13T02:37:06.912Z'),'2026-10-11');
 assert.equal(r.status,'retrospective');assert.equal(r.integrityVerified,true);assert.equal(r.validationCreditEligible,false);
});
test('changed entries or audit never establish prior-day evidence',async()=>{
 for(const mutate of [r=>r.entries[0].mark='消',r=>r.auditJson+=' ',r=>r.entries[0].horse_name='OTHER',r=>r.entries[0].ordinal=2,r=>r.phase='initial']){
  const r=await revision();mutate(r);const result=await markRecordProvenance(r,'2026-10-11');
  assert.equal(result.integrityVerified,false);assert.equal(result.recordedBeforeRaceDay,false);
 }
});
test('legacy records without hash and invalid timestamps remain unverified',async()=>{
 for(const stamp of [null,'bad','2026-10-10',undefined]){
  const r=await revision();r.createdAt=stamp;assert.equal((await markRecordProvenance(r,'2026-10-11')).status,'unverified');
 }
 const r=await revision();delete r.auditSha256;assert.equal((await markRecordProvenance(r,'2026-10-11')).integrityVerified,false);
});
