import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRace} from '../src/index-v1.1.4.js';
const read=body=>parseRace({body,url:'https://www.jra.go.jp/JRADB/accessD.html'},'2026-10-03','東京',3);
test('comma-formatted published course supports debut cards without prior starts',()=>{
  const race=read('<h2>メイクデビュー東京</h2><p>コース：1,400メートル（芝・左）</p>');
  assert.equal(race.distance,1400);assert.equal(race.surface,'芝');
});
test('published course takes priority over different distances in prior starts',()=>{
  const race=read('<h2>2歳未勝利</h2><p>コース：1,400メートル（ダート・左）</p><p>芝1600メートル 過去走</p>');
  assert.equal(race.distance,1400);assert.equal(race.surface,'ダート');
});
test('plain official distances and long jump courses remain supported',()=>{
  assert.equal(read('<h2>未勝利</h2><p>コース：1600メートル（芝）</p>').distance,1600);
  const race=read('<h2>ジャンプステークス</h2><p>コース：4,100メートル（障害）</p>');
  assert.equal(race.distance,4100);assert.equal(race.surface,'障害');
});
