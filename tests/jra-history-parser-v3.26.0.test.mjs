import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCourse,parsePastPerformances} from '../src/index-v1.3.3.js';
import {courseFromContext} from '../src/index-v1.1.1.js';

test('2026 JRA horse-profile columns map popularity/finish/jockey without one-column shift',()=>{
  const html='<table><tr>'+
    '<td>2026年6月7日</td><td>東京</td><td>安田記念 GⅠ</td><td>芝1600</td><td>良</td>'+
    '<td>18</td><td>9</td><td>4</td><td>幸 英明</td><td>58.0</td><td>474</td><td>1:31.5</td><td>116</td><td>ジャンタルマンタル</td>'+
    '</tr></table>';
  const rows=parsePastPerformances(html,'セイウンハーデス','https://www.jra.go.jp/JRADB/accessU.html','2026-10-04',5);
  assert.equal(rows.length,1);
  assert.equal(rows[0].fieldSize,18);
  assert.equal(rows[0].popularity,9);
  assert.equal(rows[0].finishPosition,4);
  assert.equal(rows[0].jockey,'幸 英明');
  assert.equal(rows[0].assignedWeight,58);
  assert.equal(rows[0].bodyWeight,474);
  assert.equal(rows[0].timeText,'1:31.5');
  assert.equal(rows[0].last3f,null);
});
test('course parser accepts both JRA course orders',()=>{
  assert.deepEqual(parseCourse('芝1800'),{surface:'芝',distance:1800});
  assert.deepEqual(parseCourse('1800芝'),{surface:'芝',distance:1800});
});
test('race metadata parser prioritizes comma-formatted official course header',()=>{
  const x=courseFromContext('第77回毎日王冠 コース：1,800メートル（芝・左） 前走 1600芝','第77回毎日王冠');
  assert.deepEqual(x,{surface:'芝',distance:1800});
});
