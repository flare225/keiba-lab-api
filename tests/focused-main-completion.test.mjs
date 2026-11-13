import test from 'node:test';
import assert from 'node:assert/strict';
import {runFocusedScheduled} from '../src/focused-race-completion.js';
const primary={date:'2026-11-15',venue:'京都',raceNo:11,expiresAt:'2026-11-15T06:35:00.000Z'};
const mains=['東京','京都'].map(venue=>({date:'2026-11-14',venue,raceNo:11,expiresAt:'2026-11-14T06:00:00.000Z'}));
const env={DB:{},LAB_SAVED_AUTOMATIC_LOCK:'true',LAB_COMPLETION_MAIN_TARGETS:JSON.stringify(mains)};
const event={cron:'*/3 * * * *'};
test('explicit weekend mains each reach prediction and seal without increasing per-tick DB stages',async()=>{
 const seen=[],sealed=[];let tick=Date.parse('2026-11-13T12:00:00Z');
 for(let i=0;i<3;i++,tick+=360000)await runFocusedScheduled(event,env,primary,{now:()=>tick,predict:async(_,n,t)=>seen.push(t),seal:async(_,o)=>sealed.push(o.target),coordinate:async()=>({ok:true})});
 assert.deepEqual(new Set(seen.map(t=>t.date+':'+t.venue)),new Set(['2026-11-14:東京','2026-11-14:京都','2026-11-15:京都']));
 assert.deepEqual(sealed,seen);assert.equal(seen.length,3);
});
test('Saturday outcomes use only existing results slot while Eliza stays pre-race, with fair rotation',async()=>{
 const got=[];let tick=Date.parse('2026-11-14T07:30:00Z');
 for(let i=0;i<2;i++,tick+=1080000){
  const r=await runFocusedScheduled(event,env,primary,{now:()=>tick,predict:async(_,n,t)=>assert.deepEqual(t,primary),seal:async(_,o)=>assert.deepEqual(o.target,primary),coordinate:async(e,v,o)=>o.jobs.results({}),outcomes:async(_,t)=>{got.push(t.venue);return{status:'focus-awaiting-result-window',externalRequests:0};}});
  assert.equal(r.externalRequests,0);
 }
 assert.deepEqual(new Set(got),new Set(['東京','京都']));
});
test('additional mains validation fails closed and quota prevents seal/source dispatch',async()=>{
 for(const value of ['{}','[]',JSON.stringify([mains[0],mains[0]]),JSON.stringify([{...mains[0],raceNo:10}]),JSON.stringify([primary])])await assert.rejects(runFocusedScheduled(event,{...env,LAB_COMPLETION_MAIN_TARGETS:value},primary,{now:()=>Date.parse('2026-11-13T12:00:00Z')}));
 const error=Object.assign(Error('quota'),{d1DailyReadLimit:true});
 await assert.rejects(runFocusedScheduled(event,env,primary,{now:()=>Date.parse('2026-11-13T12:00:00Z'),predict:async()=>{throw error},seal:()=>assert.fail('quota must stop'),coordinate:()=>assert.fail('quota must stop')}),e=>e===error);
});
test('expired Saturday outcomes never broaden the Sunday focus or return to pre-race work',async()=>{
 const r=await runFocusedScheduled(event,env,primary,{now:()=>Date.parse('2026-11-15T07:00:00Z'),coordinate:async(e,v,o)=>o.jobs.results({}),outcomes:async(_,t)=>{assert.deepEqual(t,primary);return{status:'focus-awaiting-result-window',externalRequests:0}},predict:()=>assert.fail('no post-cutoff forecast'),seal:()=>assert.fail('no reseal')});
 assert.equal(r.externalRequests,0);
});
