import test from 'node:test';import assert from 'node:assert/strict';
import {assessPositionHistory,buildRaceShapeEvidence} from '../src/running-style-evidence.js';
const race={date:'2026-10-12',surface:'芝',distance:1400};
const row=(date,corner='1-1-2')=>({date,venue:'京都',surface:'芝',distance:1400,fieldSize:12,cornerPositions:corner,finish:3,last3f:34,sourceUrl:'https://www.jra.go.jp/result'});
test('position evidence uses prior comparable races, retains source records and never changes scores',()=>{
 const h={available:true,recent:[row('2026-06-01'),row('2026-07-01'),row('2026-08-01'),row('2026-10-12'),{...row('2026-09-01'),surface:'ダート'}]};
 const a=assessPositionHistory(h,race);assert.equal(a.validPositionRows,3);assert.equal(a.style,'lead');assert.equal(a.guardrails.scoreWeightApplied,false);assert.ok(a.records.every(r=>r.date<race.date));assert.equal(a.records[0].sourceUrl,h.recent[0].sourceUrl);
});
test('missing, single-point, invalid and duplicate passages never produce a confident style',()=>{
 const h={available:true,recent:[row('2026-06-01','9'),row('2026-07-01','1-19'),row('2026-08-01','8-6'),row('2026-08-01','1-1')]};
 const a=assessPositionHistory(h,race);assert.equal(a.validPositionRows,1);assert.equal(a.style,'unknown');assert.equal(a.available,false);
 assert.equal(assessPositionHistory({available:false,recent:[row('2026-06-01')]},race).validPositionRows,0);
});
test('race shape preserves missing horses and does not invent a pace forecast',()=>{
 const runningStyle=assessPositionHistory({available:true,recent:[row('2026-06-01'),row('2026-07-01'),row('2026-08-01')]},race);
 const e=buildRaceShapeEvidence([{horseName:'馬A',horseNo:1,assessment:{runningStyle}},{horseName:'馬B',assessment:{}}]);
 assert.equal(e.coverageComplete,false);assert.deepEqual(e.unknownHorses,['馬B']);assert.equal(e.frontCandidates[0].horseName,'馬A');assert.equal(e.paceForecast,null);
});
