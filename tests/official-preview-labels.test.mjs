import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentContext} from '../src/race-history-assessment-v3.31.0.js';
import {comparisonPage} from '../src/mark-comparison-page-v3.42.0.js';
function db(race){return{prepare(q){if(q.includes('lab_expected_roster_registry'))return{bind(){return this},async all(){return{results:[]}}};return{bind(){return this},async first(){return race},async all(){return{results:[{horse_no:1,horse_name:'馬A',age:4},{horse_no:2,horse_name:'馬B',age:4}]}}}}}}
const race={race_key:'2026-10-11:東京:11',race_date:'2026-10-11',venue:'東京',race_no:11,race_name:null,surface:'芝',distance:1800,runner_count:2};
test('known reference race label is explicit without modifying missing official metadata',async()=>{
 const before=JSON.stringify(race),context=await assessmentContext(db(race),{date:'2026-10-11',venue:'東京',raceNo:11});
 assert.equal(context.raceNameBasis,'expected-source-label');assert.match(context.raceName,/アイルランドトロフィー（参考名称）/);
 const page=comparisonPage(context);assert.match(page,/アイルランドトロフィー（参考名称）/);assert.doesNotMatch(page,/東京11R null/);
 assert.equal(JSON.stringify(race),before);assert.equal(context.runners.length,2);
});
test('unknown or already named official race keeps its own name provenance',async()=>{
 const input={date:'2026-10-11',venue:'東京',raceNo:8};
 const missing=await assessmentContext(db({...race,race_no:8}),input);assert.equal(missing.raceName,'レース名未取得');assert.equal(missing.raceNameBasis,'unavailable');
 const named=await assessmentContext(db({...race,race_no:8,race_name:'公式名'}),input);assert.equal(named.raceName,'公式名');assert.equal(named.raceNameBasis,'stored-official-card');
});
