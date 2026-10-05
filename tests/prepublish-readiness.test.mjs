import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index-v3.8.0.js';

const noDataDb={prepare(sql){return{bind(){return{first:async()=>sql.includes('COUNT(*) AS c')?{c:0}:null,all:async()=>({results:[]})}}}}};

test('deployment check exposes the prepublication readiness build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});
 const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.version,'3.8.0');assert.equal(d.build,'prelock-readiness-explicit-track');
});

test('prospective seal refuses an implicit default track assumption',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prospective-seal?date=2099-10-10&venue=東京&race_no=11'),{},{});
 const d=await r.json();
 assert.equal(r.status,400);assert.match(d.error,/track is required/);
});

test('full boost step 7 also refuses a missing track assumption',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/full-boost?step=7&date=2099-10-10&venue=東京&race_no=11'),{},{});
 assert.equal(r.status,400);assert.match((await r.json()).error,/track is required/);
});

test('prelock readiness fails closed before the official card exists',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prelock-readiness?date=2099-10-10&venue=東京&race_no=11&track=良'),{DB:noDataDb},{});
 const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.readyToSeal,false);
 assert.deepEqual(d.blockers,['program-not-staged','official-card-not-stored']);
 assert.equal(d.target.trackAssumption,'良');
});

test('readiness itself reports a missing track assumption as a blocker',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prelock-readiness?date=2099-10-10&venue=東京&race_no=11'),{DB:noDataDb},{});
 const d=await r.json();
 assert.equal(r.status,200);assert.ok(d.blockers.includes('track-assumption-required'));
});
