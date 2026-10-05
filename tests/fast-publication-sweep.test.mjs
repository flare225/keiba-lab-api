import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rotationPairs,runScheduledFast} from '../src/fast-rotation-v3.8.1.js';
import worker from '../src/index-v3.8.1.js';

test('three-date rotation covers each of 9 date-slot pairs within five phases without duplicates',()=>{
 const seen=new Set();
 for(let hour=0;hour<5;hour++){
  const pairs=rotationPairs(3,hour);
  assert.ok(pairs.length>=1&&pairs.length<=2);
  for(const p of pairs){const key=`${p.dateIndex}:${p.slot}`;assert.equal(seen.has(key),false);seen.add(key);}
 }
 assert.equal(seen.size,9);
 for(let d=0;d<3;d++)for(let s=0;s<3;s++)assert.ok(seen.has(`${d}:${s}`));
});

test('one or two dates cover all three 8-card slots in three phases',()=>{
 for(const count of [1,2]){
  const seen=new Set();
  for(let hour=0;hour<3;hour++)for(const p of rotationPairs(count,hour))seen.add(`${p.dateIndex}:${p.slot}`);
  assert.equal(seen.size,count*3);
 }
});

test('fast scheduled collection reaches all 72 cards in five hourly phases',async()=>{
 const dates=['2026-10-10','2026-10-11','2026-10-12'],seen=new Set();let staged=0;
 const db={prepare(){return{bind(){return{all:async()=>({results:dates.map(race_date=>({race_date}))})}}}}};
 const deps={today:()=> '2026-10-05',stage:async request=>{staged++;return new Response(JSON.stringify({ok:true,successfulDates:3,totalProgramRaces:72,runs:[]}));},ingest:async request=>{const u=new URL(request.url),d=u.searchParams.get('date'),cursor=Number(u.searchParams.get('cursor'));for(let i=cursor;i<cursor+8;i++){const key=`${d}:${i}`;assert.equal(seen.has(key),false);seen.add(key);}return{date:d,attempted:8,storedRaceCards:8,storedRunners:80,runs:Array.from({length:8},()=>({status:'saved'})),discoveryErrors:[]};}};
 for(let hour=0;hour<5;hour++){const r=await runScheduledFast({scheduledTime:hour*3600000},{DB:db},{},deps);assert.ok(r.pairs.length<=2);}
 assert.equal(staged,5);assert.equal(seen.size,72);
});

test('v3.8.1 deployment check identifies fast sweep build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.version,'3.8.1');assert.equal(d.build,'five-hour-publication-sweep');
});
