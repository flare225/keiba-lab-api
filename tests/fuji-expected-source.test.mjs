import test from 'node:test';import assert from 'node:assert/strict';
import {FUJI_EXPECTED_SOURCE as fuji,SHUKA_EXPECTED_SOURCE as shuka,expectedAge,sourceFor,validatePreview} from '../src/expected-runner-preview-v3.30.0.js';
import {upcomingExpectedSources} from '../src/expected-history-collection-v3.46.0.js';
import app from '../src/index-v3.49.0.js';
test('Fuji and Shuka both enter this weekend priority queue with accurate individual ages and no numbered card',async()=>{
 const list=upcomingExpectedSources(Date.parse('2026-10-14T23:00:00Z'));assert.deepEqual(list,[fuji,shuka]);assert.equal(fuji.names.length,14);assert.equal(new Set(fuji.names).size,14);assert.equal(sourceFor({date:fuji.date,venue:fuji.venue,raceNo:11}),fuji);assert.equal(expectedAge(fuji,'エコロアルバ'),3);assert.equal(expectedAge(fuji,'デビットバローズ'),7);assert.throws(()=>expectedAge(fuji,'別馬'));
 assert.throws(()=>validatePreview({date:fuji.date,venue:fuji.venue,raceNo:11,marks:[{horseName:fuji.names[0],horseNo:1,mark:'注'}]}),/馬番は未確定/);
 const response=await app.fetch(new Request('https://test/v1/lab/expected-runners?date=2026-10-17&venue='+encodeURIComponent('東京')+'&race_no=11'),{DB:{prepare(){return{bind(){return{async first(){return null},async all(){return{results:[]}}}}}}}},{});const d=await response.json();assert.equal(d.ok,true);assert.equal(d.runners.length,14);assert(d.runners.every(r=>r.horseNo===null));assert.equal(d.source.provider,'netkeiba');assert.match(d.source.sourceNotice,/正式出走確定.*未確認/);
});
