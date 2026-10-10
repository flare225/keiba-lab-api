import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseSupplementalCard} from '../src/supplemental-numbered-card.js';
// A deterministic HTML-shaped parser fixture is used in CI.
// An optional externally saved page may still be exercised in a local developer session.
const horseRows=Array.from({length:16},(_,i)=>{
 const no=i+1,frame=Math.ceil(no/2),name=i===0?'ニシノティアモ':'テスト馬'+no;
 const age=i===0?'牝5':'牡4',weight=i===0?'55':'57',jockey=i===0?'津村':'検証騎手';
 return '<tr id="tr_'+no+'" class="HorseList"><td>'+frame+'</td><td class="Umaban'+no+' Txt_C">'+no+'</td><td></td><td>'+name+'</td><td>'+age+'</td><td>'+weight+'</td><td>'+jockey+'</td></tr>';
}).join('');
const fixture='<html><head><title>アイルランドT 2026年10月11日 東京11R</title></head><body><div class="RaceData02">16頭</div><table>'+horseRows+'</table></body></html>';
const html=fs.existsSync('/tmp/netkeiba-ireland-card.html')?fs.readFileSync('/tmp/netkeiba-ireland-card.html','utf8'):fixture;
test('Ireland card parser extracts sixteen numbered runners from HTML table structure',()=>{
 const r=parseSupplementalCard(html);assert.equal(r.length,16);
 assert.deepEqual(r[0],{frameNo:1,horseNo:1,horseName:'ニシノティアモ',sex:'牝',age:5,assignedWeight:55,jockey:'津村'});
 assert.equal(r[15].horseNo,16);assert.equal(r[15].frameNo,8);
});
test('supplemental parser rejects mismatched race and missing numbers',()=>{
 assert.throws(()=>parseSupplementalCard(html.replaceAll('2026年10月11日','2026年10月12日')));
 const broken=html.replace(/(<td class="Umaban\d+ Txt_C">)16(<\/td>)/,'$117$2');
 assert.throws(()=>parseSupplementalCard(broken));
});
