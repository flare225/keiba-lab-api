import test from 'node:test';
import assert from 'node:assert/strict';
import app,{normalizeMarks,markAlignment,VERSION} from '../src/index-v3.8.7.js';

test('v3.8.7 identity and capabilities keep human marks independent',async()=>{
  assert.equal(VERSION,'3.8.7');
  const r=await app.fetch(new Request('https://lab.test/v1/lab/user-mark-capabilities'),{},{});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.principles.humanMarksAreIndependentInput,true);
  assert.equal(d.principles.scoreMutation,false);
  assert.equal(d.principles.officialCardRequiredForPostDrawAndFinal,true);
  assert.equal(d.principles.horseNumbersNeverInferredBeforeOfficialCard,true);
});

test('final marks require explicit track and duplicate runners are rejected',()=>{
  assert.throws(()=>normalizeMarks({phase:'final',marks:[{horseNo:1,mark:'◎'}]}),/explicit track/);
  assert.throws(()=>normalizeMarks({phase:'post_draw',track:'良',marks:[{horseNo:1,mark:'◎'},{horseNo:1,mark:'○'}]}),/duplicate/);
  const x=normalizeMarks({phase:'post_draw',track:'良',marks:[{horseNo:1,mark:'◎'},{horseNo:3,mark:'△'}]});
  assert.equal(x.marks.length,2);
  assert.equal(x.track,'良');
});

test('human/model disagreement is surfaced rather than changing LABO rank',()=>{
  assert.deepEqual(markAlignment('◎',1),{level:'aligned',reviewPriority:'low',reason:'◎ inside LABO top 3'});
  assert.equal(markAlignment('◎',8).level,'conflict');
  assert.equal(markAlignment('◎',8).reviewPriority,'critical');
  assert.equal(markAlignment('消',2).reviewPriority,'critical');
  assert.equal(markAlignment('△',9).level,'watch');
});

test('write endpoint fails closed when the production write secret is not configured',async()=>{
  const fakeDb={};
  const req=new Request('https://lab.test/v1/lab/user-marks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-10-10',venue:'東京',raceNo:11,phase:'post_draw',track:'良',confirm:'SAVE',marks:[{horseNo:1,mark:'◎'}]})});
  const r=await app.fetch(req,{DB:fakeDb},{});
  assert.equal(r.status,503);
  const d=await r.json();
  assert.match(d.error,/writes disabled/);
  assert.equal(d.scoreMutation,false);
});
