import test from 'node:test';import assert from 'node:assert/strict';import {historyForExpected} from '../src/expected-runner-preview-v3.30.0.js';import {comparableHistoryValue as normalize} from '../src/history-value-normalization.js';
import {readFileSync} from 'node:fs';
test('all twenty observed production holds contain equivalent source spellings',()=>{const rows=JSON.parse(readFileSync(new URL('./fixtures/history-format-conflicts-20261021.json',import.meta.url),'utf8'));assert.equal(rows.length,20);for(const horse of rows){assert.ok(horse.conflicts.length);for(const conflict of horse.conflicts)assert.equal(new Set(conflict.values.map(v=>normalize(conflict.field,v))).size,1,horse.horseName+' '+conflict.field);}});
const source={date:'2026-10-24',age:3,surface:'ダート',distance:1800,snapshotId:'registered:test'};
const raw={race_date:'2026-10-11',venue:'京都',surface:'ダート',distance:1800,finish_position:2,field_size:12,time_text:'57.4',last3f:38.1,corner_positions:'7 6 8 8',track_condition:'稍重',source_url:'https://www.jra.go.jp/'};
test('production format differences compare equal while original provider values survive',async()=>{
 const expected={...raw,surface:'ダ',time_text:'0:57.4',corner_positions:'7-6-8-8',track_condition:'稍',source_url:'https://race.netkeiba.com/'};
 const pre={rich:[{...raw}],profiles:[],expected:[{payload_json:JSON.stringify(expected)}],detailEvidence:[],warnings:[]};const before=JSON.stringify(pre);
 const h=await historyForExpected(null,source,'A',8,pre);assert.equal(h.available,true);assert.deepEqual(h.conflictDetails,[]);assert.ok(!h.warnings.includes('source-value-conflict'));assert.equal(h.recent[0].surface,'ダート');assert.equal(h.recent[0].cornerPositions,'7 6 8 8');assert.equal(h.recent[0].sourceEvidence[1].values.surface,'ダ');assert.equal(h.recent[0].sourceEvidence[0].values.cornerPositions,'7 6 8 8');assert.equal(JSON.stringify(pre),before);
});
test('genuine finish, distance and same-provider closing-time conflicts remain rejected',async()=>{
 for(const changed of [{finish_position:5},{distance:1700}]){const h=await historyForExpected(null,source,'A',8,{rich:[raw],profiles:[],expected:[{payload_json:JSON.stringify({...raw,...changed})}],detailEvidence:[],warnings:[]});assert.equal(h.available,false);assert.ok(h.conflictDetails.length>0);}
 const h=await historyForExpected(null,source,'A',8,{rich:[],profiles:[raw,{...raw,last3f:39.1}],expected:[],detailEvidence:[],warnings:[]});assert.equal(h.available,false);assert.ok(h.conflictDetails.some(d=>d.field==='last3f'));
});
test('normalization preserves unknown formats and differing times',()=>{assert.equal(normalize('surface','ダ?'),'ダ?');assert.equal(normalize('cornerPositions','7 6 8 8'),'7-6-8-8');assert.equal(normalize('cornerPositions','7 X 8'),'7 X 8');assert.equal(normalize('time','0:57.4'),57.4);assert.notEqual(normalize('time','0:57.4'),normalize('time','0:57.5'));});
