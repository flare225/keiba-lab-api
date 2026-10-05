import test from 'node:test';
import assert from 'node:assert/strict';
import {markForRank,normalizePrediction} from '../src/index-v3.11.0.js';

test('locked rank-to-mark policy is deterministic and only marks top five',()=>{
 assert.deepEqual([1,2,3,4,5,6].map(markForRank),['◎','○','▲','△','☆',null]);
});

test('history LABO marks are derived only from the immutable pre-result rank',()=>{
 const p=normalizePrediction({race:{trackCondition:'良'},runners:[{horseNo:2,horseName:'B',rank:2,score:81.2},{horseNo:1,horseName:'A',rank:1,score:84.4},{horseNo:6,horseName:'F',rank:6,score:70}]},{modelVersion:'3.3.0-prospective',snapshotSha256:'abc',hashVerified:true,sealedAt:'2026-10-09T00:00:00Z'});
 assert.equal(p.locked,true);assert.equal(p.hashVerified,true);assert.equal(p.runners[0].horseName,'A');assert.equal(p.runners[0].mark,'◎');assert.equal(p.runners[1].mark,'○');assert.equal(p.runners[2].mark,null);assert.equal(p.top5.length,2);assert.equal(p.guardrails.resultDataUsed,false);assert.equal(p.guardrails.recomputedAfterResult,false);
});
