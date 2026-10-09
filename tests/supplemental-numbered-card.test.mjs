import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseSupplementalCard} from '../src/supplemental-numbered-card.js';
const html=fs.readFileSync('/tmp/netkeiba-ireland-card.html','utf8');
test('netkeiba Ireland card parses 16 numbered runners with frames and weights',()=>{const r=parseSupplementalCard(html);assert.equal(r.length,16);assert.deepEqual(r[0],{frameNo:1,horseNo:1,horseName:'ニシノティアモ',sex:'牝',age:5,assignedWeight:55,jockey:'津村'});assert.equal(r[15].horseNo,16);assert.equal(r[15].frameNo,8);});
test('supplemental parser rejects mismatched race and missing numbers',()=>{assert.throws(()=>parseSupplementalCard(html.replaceAll('2026年10月11日','2026年10月12日')));const broken=html.replace(/(<td class="Umaban\d+ Txt_C">)16(<\/td>)/,'$117$2');assert.throws(()=>parseSupplementalCard(broken));});
