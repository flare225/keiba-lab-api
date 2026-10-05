import test from 'node:test';
import assert from 'node:assert/strict';
import app,{VERSION} from '../src/index-v3.8.8.js';

test('v3.8.8 capabilities require official evidence and preserve nulls',async()=>{
  assert.equal(VERSION,'3.8.8');
  const r=await app.fetch(new Request('https://lab.test/v1/lab/user-mark-capabilities'),{},{});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.principles.humanMarksAreIndependentInput,true);
  assert.equal(d.principles.scoreMutation,false);
  assert.equal(d.principles.officialCardEvidenceRequired,true);
  assert.equal(d.principles.nullEvidenceNeverPresentedAsZero,true);
  assert.equal(d.writeReady,false);
});

test('post_draw mark audit refuses to run without a verified official numbered card',async()=>{
  const db={prepare(){return{bind(){return{first:async()=>null}}}}};
  const req=new Request('https://lab.test/v1/lab/user-mark-audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-10-10',venue:'東京',raceNo:11,phase:'post_draw',track:'良',marks:[{horseNo:1,mark:'◎'}]})});
  const r=await app.fetch(req,{DB:db},{});
  assert.equal(r.status,409);
  const d=await r.json();
  assert.match(d.error,/verified official numbered card/);
  assert.equal(d.scoreMutation,false);
});
