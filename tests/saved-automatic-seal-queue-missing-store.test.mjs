import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledSavedAutomaticSeal} from '../src/saved-automatic-seal-queue.js';

test('missing scheduler storage is reported without attempting LOCK writes',async()=>{
 let reads=0,writes=0;
 const db={prepare(sql){
  if(/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql)){writes++;throw Error('unexpected write');}
  reads++;
  return {bind(){return this;},async first(){throw Error('D1_ERROR: no such table: lab_automatic_predictions_v1')}};
 }};
 const result=await scheduledSavedAutomaticSeal(db,{enabled:true,now:()=>Date.parse('2026-10-30T00:00:00Z')});
 assert.equal(result.status,'seal-store-unavailable');
 assert.equal(result.ok,false);
 assert.equal(result.sealed,0);
 assert.equal(result.retryWrite,false);
 assert.equal(result.externalRequests,0);
 assert.equal(reads,1);
 assert.equal(writes,0);
});

test('uppercase D1 missing-table error also stops without writes',async()=>{
 let reads=0,writes=0;
 const db={prepare(sql){
  if(/^\\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql)){writes++;throw Error('unexpected write');}
  reads++;
  return {bind(){return this;},async first(){throw Error('D1_ERROR: NO SUCH TABLE: lab_prospective_seals')}};
 }};
 const result=await scheduledSavedAutomaticSeal(db,{enabled:true,now:()=>Date.parse('2026-10-30T00:00:00Z')});
 assert.equal(result.status,'seal-store-unavailable');
 assert.equal(result.retryWrite,false);
 assert.equal(result.sealed,0);
 assert.equal(reads,1);
 assert.equal(writes,0);
});
