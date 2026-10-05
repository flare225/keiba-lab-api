import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalEvidenceForHorse} from '../src/history-evidence-v3.9.1.js';

function dbWith(rows){return{prepare(sql){return{bind(...args){return{async all(){return{results:rows,sql,args}}}}}}}}

test('summarizes stored history without mutating a score',async()=>{
 const rows=[
  {race_date:'2026-09-27',venue:'中山',race_no:11,race_name:'A',finish_position:1,finish_status:'finished',time_seconds:93.1,corner_positions:'3-3',last3f:33.4,popularity:2,odds:4.2,body_weight:480,jockey:'A',assigned_weight:56},
  {race_date:'2026-09-01',venue:'東京',race_no:10,race_name:'B',finish_position:4,finish_status:'finished',time_seconds:94.0,corner_positions:'6-6',last3f:33.8,popularity:1,odds:2.1,body_weight:478,jockey:'B',assigned_weight:56}
 ];
 const e=await historicalEvidenceForHorse(dbWith(rows),{horseName:'テスト馬',beforeDate:'2026-10-10'});
 assert.equal(e.antiLeakageRule,'race_date < target_date');
 assert.equal(e.summary.storedStarts,2);assert.equal(e.summary.wins,1);assert.equal(e.summary.top3,1);assert.equal(e.summary.avgFinish,2.5);assert.equal(e.summary.avgLast3f,33.6);
});

test('SQL enforces strict before-date cutoff',async()=>{
 let captured=null;const db={prepare(sql){return{bind(...args){captured={sql,args};return{async all(){return{results:[]}}}}}}};
 await historicalEvidenceForHorse(db,{horseName:'未来遮断馬',beforeDate:'2026-10-10',limit:8});
 assert.match(captured.sql,/r\.race_date<\?/);assert.deepEqual(captured.args.slice(0,2),['未来遮断馬','2026-10-10']);
});
