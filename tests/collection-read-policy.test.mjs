import test from 'node:test';import assert from 'node:assert/strict';
import {COLLECTION_READ_POLICY,shouldRunScheduled} from '../src/collection-read-policy.js';import app from '../src/index-v3.49.0.js';
const event=(cron,minute)=>({cron,scheduledTime:Date.UTC(2026,9,15,0,minute)});
test('scheduled source and learning budgets skip excess slots, preserve detail slots and do not claim measured quota protection',async()=>{
 assert.equal(Array.from({length:20},(_,i)=>shouldRunScheduled(event('*/3 * * * *',i*3))).filter(Boolean).length,10);
 assert.equal(Array.from({length:6},(_,i)=>shouldRunScheduled(event('0,10,20,30,40,50 * * * *',i*10))).filter(Boolean).length,1);
 for(let minute=0;minute<60;minute+=12)assert.equal(shouldRunScheduled(event('*/3 * * * *',minute)),true);
 assert.equal(shouldRunScheduled(event('0 * * * *',0)),true);assert.equal(COLLECTION_READ_POLICY.dailyQuotaStopGuaranteed,false);
 const db={prepare(){throw Error('skipped event must not touch D1')}};
 await app.scheduled(event('*/3 * * * *',3),{DB:db},{});await app.scheduled(event('0,10,20,30,40,50 * * * *',10),{DB:db},{});
 const r=await app.fetch(new Request('https://test/v1/lab/collection-read-policy'),{DB:db},{});const d=await r.json();assert.equal(d.ok,true);assert.equal(d.policy.sourceRunsPerHour,10);assert.equal(d.policy.userMarkWritesThrottled,false);
});
