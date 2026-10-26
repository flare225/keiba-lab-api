import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledSavedAutomaticSeal} from '../src/saved-automatic-seal-queue.js';

test('automatic LOCK scheduler is opt-in and never touches D1 when disabled',async()=>{
 let calls=0;
 const db={prepare(){calls++;throw Error('D1 must not be queried while disabled')}};
 const result=await scheduledSavedAutomaticSeal(db);
 assert.deepEqual(result,{ok:true,status:'disabled',sealed:0,externalRequests:0});
 assert.equal(calls,0);
});

test('automatic LOCK scheduler rejects empty enabled mode without touching D1',async()=>{
 let calls=0;
 const db={prepare(){calls++;throw Error('unexpected D1 call')}};
 const result=await scheduledSavedAutomaticSeal(db,{enabled:false,now:()=>{throw Error('clock should not be read')}});
 assert.equal(result.status,'disabled');
 assert.equal(calls,0);
});
