import test from 'node:test';import assert from 'node:assert/strict';
import {SHUKA_EXPECTED_SOURCE,sourceFor,validatePreview,expectedAge} from '../src/expected-runner-preview-v3.30.0.js';
import {upcomingExpectedSources} from '../src/expected-history-collection-v3.46.0.js';
import app from '../src/index-v3.49.0.js';
test('official Shuka registration enters the upcoming collection queue without inventing a numbered card',async()=>{
 const s=SHUKA_EXPECTED_SOURCE;assert.equal(s.names.length,18);assert.equal(new Set(s.names).size,18);assert.equal(sourceFor({date:'2026-10-18',venue:'京都',raceNo:11}),s);assert(upcomingExpectedSources(Date.parse('2026-10-14T23:00:00Z')).includes(s));assert.equal(expectedAge(s,'モンローウォーク'),3);
 assert.throws(()=>validatePreview({date:s.date,venue:s.venue,raceNo:11,marks:[{horseName:s.names[0],horseNo:1,mark:'注'}]}),/馬番は未確定/);
 assert.throws(()=>validatePreview({date:s.date,venue:s.venue,raceNo:11,phase:'final',marks:[{horseName:s.names[0],mark:'注'}]}),/初期印のみ/);
 const response=await app.fetch(new Request('https://test/v1/lab/expected-runners?date=2026-10-18&venue='+encodeURIComponent('京都')+'&race_no=11'),{},{}),data=await response.json();assert.equal(data.ok,true);assert.equal(data.runners.length,18);assert(data.runners.every(r=>r.horseNo===null&&r.age===3));assert.equal(data.source.provider,'JRA');
});
