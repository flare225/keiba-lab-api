import test from 'node:test';import assert from 'node:assert/strict';import {buildDecisionLab} from '../src/decision-lab-v3.12.0.js';
const prediction={available:true,runners:[{horseNo:1,horseName:'A',rank:1,score:90,components:{track:-2,heavy:-3,highPace:2}},{horseNo:2,horseName:'B',rank:2,score:88,components:{slowPace:2}},{horseNo:3,horseName:'C',rank:3,score:85,components:{position:-1}}]};
const user={marked:[{horseNo:1,mark:'◎'},{horseNo:3,mark:'△'}]};
test('flags counterevidence without mutating locked prediction',()=>{const before=JSON.stringify(prediction);const x=buildDecisionLab(prediction,user);assert.equal(x.available,true);assert.equal(x.counterevidence[0].horseNo,1);assert.equal(JSON.stringify(prediction),before);assert.equal(x.guardrails.resultLeakage,false)});
test('finds LABO top horse omitted by user',()=>{const x=buildDecisionLab(prediction,user);assert.deepEqual(x.missedHorses.map(v=>v.horseNo),[2])});
test('builds nine track pace scenarios and WHY log',()=>{const x=buildDecisionLab(prediction,user);assert.equal(x.scenarios.length,9);assert.ok(x.why.length>=3);assert.equal(x.guardrails.automaticWeightMutation,false)});
