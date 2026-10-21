import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProvisionalPrediction} from '../src/provisional-expected-prediction.js';
const now=Date.parse('2026-10-21T00:01:00Z'),source={date:'2026-10-25',venue:'新潟',raceNo:11,names:Array.from({length:22},(_,i)=>'馬'+i),snapshotId:'registered:test',sourceUrl:'https://example.test/roster'};
const conditions={surface:'芝',distance:1000,source_url:'https://example.test/program'};
const histories=new Map(source.names.map(name=>[name,{horseName:name,available:true,recent:[{date:'2026-09-01',venue:'新潟',surface:'芝',distance:1000,finish:2,fieldSize:18,dbSource:'netkeiba-dated-history'},{date:source.date,finish:1,fieldSize:18}]}]));
test('22 expected entries need no user marks or official numbers; ties and unverified provenance stay explicit',()=>{
 const r=buildProvisionalPrediction(source,conditions,histories,now);assert.equal(r.runnerCount,22);assert.equal(r.scoredRunners,22);assert.ok(r.runners.every(x=>x.rank===1&&x.mark==='◎'&&x.horseNo===null&&x.frameNo===null&&x.assessment.historyRows===1&&x.assessment.provenance==='includes-netkeiba-unverified'));assert.equal(r.guardrails.locked,false);assert.equal(r.guardrails.persisted,false);assert.equal(r.guardrails.eligibleForLearning,false);assert.equal(r.guardrails.humanMarksUsed,false);
});
test('missing evidence is unranked and never receives a fabricated mark',()=>{
 const h=new Map(histories);h.set('馬0',{available:false,recent:[]});const r=buildProvisionalPrediction(source,conditions,h,now);assert.equal(r.runners[0].rank,null);assert.equal(r.runners[0].score,null);assert.equal(r.runners[0].mark,null);
});
test('past/same-day targets and unknown race conditions fail closed',()=>{
 for(const date of ['2026-10-20','2026-10-21'])assert.throws(()=>buildProvisionalPrediction({...source,date},conditions,histories,now));assert.throws(()=>buildProvisionalPrediction(source,{},histories,now));
});
