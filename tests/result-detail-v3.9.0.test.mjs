import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialResultDetails} from '../src/result-detail-v3.9.0.js';

const runners=[
 {horse_no:1,horse_name:'テストホース'},
 {horse_no:2,horse_name:'サンプルスター'},
];
const html=`<html><body><table><tr><th>着順</th><th>枠</th><th>馬番</th><th>馬名</th><th>性齢</th><th>斤量</th><th>騎手</th><th>タイム</th><th>着差</th><th>通過順位</th><th>上り</th><th>単勝</th><th>人気</th><th>馬体重</th></tr><tr><td>1着</td><td>1</td><td>1</td><td>テストホース</td><td>牡3</td><td>56.0</td><td>騎手A</td><td>1:33.4</td><td></td><td>2-2</td><td>33.5</td><td>2.4</td><td>1</td><td>480(+2)</td></tr><tr><td>2</td><td>2</td><td>2</td><td>サンプルスター</td><td>牝3</td><td>55.0</td><td>騎手B</td><td>1:33.6</td><td>1 1/4</td><td>4-4</td><td>33.3</td><td>5.8</td><td>3</td><td>462(-4)</td></tr></table></body></html>`;

test('parses rich official result fields only when runner identity is complete',()=>{
 const p=parseOfficialResultDetails(html,runners);
 assert.equal(p.ok,true);
 assert.equal(p.identity.verified,true);
 assert.equal(p.rows.length,2);
 assert.deepEqual(p.rows[0],{
  horseNo:1,frameNo:1,horseName:'テストホース',finishPosition:1,finishStatus:'finished',sex:'牡',age:3,assignedWeight:56,jockey:'騎手A',timeText:'1:33.4',timeSeconds:93.4,margin:'',cornerPositions:'2-2',last3f:33.5,popularity:1,odds:2.4,bodyWeight:480,bodyWeightChange:2
 });
 assert.equal(p.rows[1].finishPosition,2);
 assert.equal(p.rows[1].bodyWeightChange,-4);
});

test('fails closed when an official-card runner is missing from the result table',()=>{
 const truncated=html.replace(/<tr><td>2<\/td>[\s\S]*?<\/tr>/,'');
 const p=parseOfficialResultDetails(truncated,runners);
 assert.equal(p.ok,false);
 assert.equal(p.identity.verified,false);
 assert.deepEqual(p.identity.missingNames,['サンプルスター']);
});

test('preserves non-finish status without inventing a finish position',()=>{
 const dnf=html.replace('<td>2</td><td>2</td><td>2</td><td>サンプルスター</td>','<td>中止</td><td>2</td><td>2</td><td>サンプルスター</td>');
 const p=parseOfficialResultDetails(dnf,runners);
 assert.equal(p.ok,true);
 assert.equal(p.rows[1].finishPosition,null);
 assert.equal(p.rows[1].finishStatus,'did-not-finish');
});


test('parses JRA 推定上り as the official per-horse last 3 furlongs value',()=>{
 const estimated=html.replace('<th>上り</th>','<th>推定上り</th>');
 const p=parseOfficialResultDetails(estimated,runners);
 assert.equal(p.ok,true);
 assert.equal(p.rows[0].last3f,33.5);
 assert.equal(p.rows[1].last3f,33.3);
});
