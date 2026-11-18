import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runFocusedScheduled,focusedRaceTarget,focusScheduleState} from '../src/focused-race-completion.js';
const primary={date:'2026-11-23',venue:'東京',raceNo:11,expiresAt:'2026-11-23T15:25:00+09:00'};
const mains=['2026-11-21','2026-11-22','2026-11-23'].flatMap(date=>['東京','京都','福島'].map(venue=>({...primary,date,venue,expiresAt:date+'T15:00:00+09:00'}))).filter(t=>t.date!==primary.date||t.venue!==primary.venue);
const env={DB:{},LAB_SAVED_AUTOMATIC_LOCK:'true',LAB_COMPLETION_MAIN_TARGETS:JSON.stringify(mains),LAB_COMPLETION_PREPARATION_TARGETS:JSON.stringify(mains)};
const key=t=>t.date+':'+t.venue+':'+t.raceNo;
const event={cron:'*/3 * * * *'};
test('reviewed three-day nine-main scope gives each target history, forecast and seal with one source job per tick',async()=>{
 const forecasts=[],seals=[],history=[];let prior=null,stamp=Date.parse('2026-11-18T09:00:00Z');
 for(let i=0;i<9;i++,stamp+=360000){let calls=0;
  const r=await runFocusedScheduled(event,env,primary,{now:()=>stamp,readiness:async()=>({ok:true,remainingHorses:0,unverifiedStoredHorses:0}),predict:async(_,n,t)=>forecasts.push(key(t)),seal:async(_,o)=>seals.push(key(o.target)),prepareRoster:async()=>({saved:0}),collect:async(_,t,c)=>{history.push(key(t));assert.equal(c.previousCardSelection?.target??key(t),key(t));return{ok:true,status:'complete',externalRequests:0}},coordinate:async(e,v,o)=>{calls++;return o.jobs.history({previousCardSelection:prior})}});
  assert.equal(calls,1);prior=r.cardSelection;
 }
 assert.equal(new Set(forecasts).size,9);assert.deepEqual(seals,forecasts);assert.equal(new Set(history).size,9);
});
test('hourly provisional preparation rotates within all reviewed mains without extra source invocations',async()=>{
 const got=[];let stamp=Date.parse('2026-11-18T00:00:00Z');
 for(let i=0;i<9;i++,stamp+=3600000)await runFocusedScheduled({cron:'0 * * * *'},env,primary,{now:()=>stamp,provisional:async(db,n,o)=>{await o.prepareRoster();return{ok:true}},prepareRoster:async(_,t)=>{got.push(key(t));return{saved:0}},coordinate:()=>assert.fail('no extra source job')});
 assert.equal(new Set(got).size,9);
});
test('old expired focus and invalid reviewed targets remain closed; no broad fallback',async()=>{
 const now=()=>Date.parse('2026-11-18T09:00:00Z');
 const old={...primary,date:'2026-11-15',expiresAt:'2026-11-15T15:35:00+09:00'};
 const r=await runFocusedScheduled(event,{DB:{}},old,{now,coordinate:()=>assert.fail('no fallback')});assert.equal(r.status,'focus-expired-or-outside-window');
 for(const targets of [[primary],[...mains,mains[0]],[{...mains[0],date:'2026-11-24'}],[{...mains[0],date:'2026-11-16',expiresAt:'2026-11-16T15:00:00+09:00'}],[{...mains[0],raceNo:10}]])await assert.rejects(runFocusedScheduled(event,{...env,LAB_COMPLETION_MAIN_TARGETS:JSON.stringify(targets)},primary,{now}));
});
test('only unexpired reviewed targets get forecasts and only ended targets get outcomes',async()=>{
 const stamp=Date.parse('2026-11-22T07:00:00Z'),seen=[];
 for(let i=0;i<9;i++)await runFocusedScheduled(event,env,primary,{now:()=>stamp+i*360000,readiness:async()=>({ok:true,remainingHorses:0,unverifiedStoredHorses:0}),predict:async(_,n,t)=>assert.equal(t.date,'2026-11-23'),seal:async()=>{},coordinate:async(e,v,o)=>o.jobs.results({}),outcomes:async(_,t)=>{seen.push(t);assert.equal(focusScheduleState(t,event,stamp),'outcomes');return{externalRequests:0}}});
 assert(seen.length>0);assert(seen.every(t=>t.date!=='2026-11-23'));
});
test('release configuration contains exactly the six officially reviewed mains, preserving cutoff and scope',()=>{
 const text=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');const get=k=>JSON.parse(JSON.parse(text.split('\n').find(l=>l.includes('"'+k+'"')).trim().replace(/,$/,'').split(/:\s(.+)/s)[1]));
 const p=focusedRaceTarget(JSON.stringify(get('LAB_COMPLETION_FOCUS'))),m=get('LAB_COMPLETION_MAIN_TARGETS');
 assert.deepEqual(new Set([p,...m].map(key)),new Set(['2026-11-21:京都:11','2026-11-21:福島:11','2026-11-22:東京:11','2026-11-22:京都:11','2026-11-23:東京:11','2026-11-23:福島:11']));
 assert.deepEqual(get('LAB_COMPLETION_PREPARATION_TARGETS'),m);assert.equal(p.expiresAt,'2026-11-23T06:25:00.000Z');
});
