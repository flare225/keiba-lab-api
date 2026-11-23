import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationRaceTargets} from '../src/focused-race-completion.js';
test('explicit 12R main uses the same week and expiry limits as 11R',()=>{
 const focus={date:'2026-11-29',venue:'東京',raceNo:12,expiresAt:'2026-11-29T15:35:00+09:00'};
 const other={...focus,venue:'京都'};
 const sat={...other,date:'2026-11-28',raceNo:11,expiresAt:'2026-11-28T15:35:00+09:00'};
 const run=(targets,now='2026-11-28T10:00:00+09:00')=>preparationRaceTargets(JSON.stringify(targets),focus,Date.parse(now));
 assert.deepEqual(run([sat,other]).map(t=>[t.date,t.raceNo]),[['2026-11-28',11],['2026-11-29',12]]);
 for(const bad of [[other,other],[focus],[{...other,raceNo:10}],[{...other,date:'2026-11-30'}]]) assert.throws(()=>run(bad));
 assert.deepEqual(run([sat,other],'2026-11-29T15:36:00+09:00'),[]);
});
