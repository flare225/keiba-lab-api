import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOrdinaryRosterQueue,selectOrdinaryCandidate} from '../scripts/prepare-ordinary-roster-queue.mjs';
import {EXPECTED_ROSTER_SEEDS} from '../src/expected-roster-seeds.js';
const plan=prepareOrdinaryRosterQueue();
test('offline queue covers exactly the remaining 52 slots and cannot claim new data or publication',()=>{
 assert.deepEqual(plan.summary,{programSlots:72,previouslyVerifiedRosterRaces:20,previouslyVerifiedRosterEntries:353,pendingRosterCandidates:52,newRacesSaved:0});
 const known=new Set(plan.knownRosters.map(r=>r.raceKey));assert.equal(new Set(plan.pending.map(r=>r.raceKey)).size,52);
 for(const r of plan.pending){assert.equal(known.has(r.raceKey),false);assert.equal(r.runners,null);assert.equal(r.publicationStatus,'not-checked');assert.equal(r.sourceCandidate.fetchAuthorized,false);assert.equal(Number(new URL(r.sourceCandidate.url).searchParams.get('race_id').slice(-2)),r.raceNo);assert.equal(r.officialCollector.body.raceNo,r.raceNo);}
 assert.equal(prepareOrdinaryRosterQueue().sha256,plan.sha256);assert.equal(plan.guardrails.databaseCalls,0);
});
test('candidate selection needs quota recovery and gate confirmation, respects active cooldown/lease',()=>{
 const now=Date.parse('2026-10-21T00:01:00Z');assert.equal(selectOrdinaryCandidate(plan,{now}).reason,'quota-recovery-unconfirmed');assert.equal(selectOrdinaryCandidate(plan,{now,quotaRecovered:true}).reason,'shared-gate-unconfirmed');
 const ready={now,quotaRecovered:true,gateChecked:true};assert.equal(selectOrdinaryCandidate(plan,{...ready,lockedUntil:now+1000}).status,'cooldown');assert.equal(selectOrdinaryCandidate(plan,{...ready,nextBatchAt:new Date(now+1000).toISOString()}).status,'cooldown');assert.throws(()=>selectOrdinaryCandidate(plan,{...ready,nextBatchAt:'invalid'}),/timestamp/);
 const chosen=selectOrdinaryCandidate(plan,ready);assert.equal(chosen.target.raceKey,'2026-10-24:東京:1');assert.equal(chosen.execute,false);
});
test('receipts skip independently verified saves and future retries without rechecking known rosters',()=>{
 const now=Date.parse('2026-10-21T00:01:00Z'),ready={now,quotaRecovered:true,gateChecked:true};
 const receipts=[{raceKey:'2026-10-24:東京:1',savedReadbackVerified:true},{raceKey:'2026-10-24:京都:1',nextAttemptAt:now+3600000}];
 assert.equal(selectOrdinaryCandidate(plan,{...ready,receipts}).target.raceKey,'2026-10-24:新潟:1');
 assert.equal(selectOrdinaryCandidate(plan,{...ready,receipts:plan.pending.map(t=>({raceKey:t.raceKey,savedReadbackVerified:true}))}).target,null);
});
test('duplicate or inconsistent sibling evidence is rejected rather than generating a misleading route',()=>{
 assert.throws(()=>prepareOrdinaryRosterQueue([...EXPECTED_ROSTER_SEEDS,EXPECTED_ROSTER_SEEDS[0]]),/duplicate/);
 const changed=structuredClone(EXPECTED_ROSTER_SEEDS);const source=changed.find(s=>s.record.date==='2026-10-24'&&s.record.venue==='東京'&&s.record.raceNo===9);source.record.sourceUrl='https://race.netkeiba.com/race/shutuba_past.html?race_id=202605040709';assert.throws(()=>prepareOrdinaryRosterQueue(changed),/Conflicting/);
});
