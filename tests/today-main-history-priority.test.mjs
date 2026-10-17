import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTodayMainHistory} from '../src/today-main-history-priority.js';
const source={date:'2026-10-17',venue:'東京',raceNo:11,priority:0};
const stamp=Date.parse('2026-10-17T09:00:00+09:00');
const db={prepare(){return{bind(){return{async first(){return{start_time:'15:45',source_url:'https://www.jra.go.jp/program'}}}}}}};
test('today missing official history takes one bounded collection slot and preserves cooldown',async()=>{
 let calls=0;const result=await collectTodayMainHistory(db,{now:()=>stamp,sources:[{...source,date:'2026-10-18'},source],status:async()=>({race:{raceKey:'fuji'},runners:[{storedRows:0,due:true}]}),collect:async(_,input)=>{calls++;assert.equal(input.batchSize,1);assert.equal(input.venue,'東京');return{ok:true,status:'cooldown',externalRequests:0}}});
 assert.equal(calls,1);assert.equal(result.status,'cooldown');assert.equal(result.priorityRaceKey,'fuji');
});
test('completed or cooling-down horses do not reserve a slot, and priority ends before post time',async()=>{
 const collect=async()=>assert.fail('unexpected fetch');
 for(const runners of [[{storedRows:2,due:true}],[{storedRows:0,due:false}]])assert.equal(await collectTodayMainHistory(db,{now:()=>stamp,sources:[source],status:async()=>({runners}),collect}),null);
 assert.equal(await collectTodayMainHistory(db,{now:()=>Date.parse('2026-10-17T15:40:00+09:00'),sources:[source],status:async()=>assert.fail('after cutoff'),collect}),null);
});
