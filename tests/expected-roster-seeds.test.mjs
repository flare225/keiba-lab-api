import test from'node:test';import assert from'node:assert/strict';import{importExpectedRosterSeed}from'../src/expected-roster-seeds.js';
test('unreviewed seed cannot write or invent roster data',async()=>{
 const db={prepare(){assert.fail('unknown seed must never reach DB')}};
 const r=await importExpectedRosterSeed(db,'not-reviewed');assert.equal(r.storedRunners,0);assert.equal(r.status,'source-reviewed-seed-not-available');
 await assert.rejects(importExpectedRosterSeed(db,{snapshotId:'x',runners:[{horseName:'fake'}]}));
});
import {EXPECTED_ROSTER_SEEDS}from'../src/expected-roster-seeds.js';
import {validateExpectedRoster}from'../src/expected-roster-registry.js';
test('reviewed JRA Kikuka registration contains all 21 three-year-olds without guessed horse numbers',()=>{
 const seed=EXPECTED_ROSTER_SEEDS[0],s=validateExpectedRoster(seed.record,Date.parse('2026-10-20T00:00:00Z'));
 assert.equal(s.runners.length,21);assert.equal(s.date,'2026-10-25');assert.equal(s.sourceUrl,'https://www.jra.go.jp/keiba/tokubetsu/pdf/2026/kikka.pdf');assert.ok(s.runners.every(r=>r.age===3&&r.horseNo===undefined));assert.ok(s.runners.some(r=>r.horseName==='マジョレルブルー'));assert.ok(s.sourceText.includes('出走可能頭数18頭'));
});
test('Artemis registration keeps the newer 14-horse secondary roster separate from JRA',()=>{
 const seed=EXPECTED_ROSTER_SEEDS.find(s=>s.record.raceName==='アルテミスステークス'),s=validateExpectedRoster(seed.record,Date.parse('2026-10-20T00:00:00Z'));
 assert.equal(s.provider,'netkeiba');assert.equal(s.runners.length,14);assert.ok(s.runners.every(r=>r.age===2));assert.ok(s.runners.some(r=>r.horseName==='ベストプラージュ'));assert.ok(!s.runners.some(r=>r.horseName==='フランソワーズ'));
 assert.equal(EXPECTED_ROSTER_SEEDS[0].record.officialHorsePage,'https://www.jra.go.jp/keiba/g1/kikka/horse.html');
});
test('expanded Tenno roster preserves original ten and attributes seven additional candidates to supplementary source',()=>{
 const original=EXPECTED_ROSTER_SEEDS.find(s=>s.snapshotId==='jra-featured-candidates-20261101-tokyo11-reviewed-20261026-v1');
 const expanded=EXPECTED_ROSTER_SEEDS.find(s=>s.snapshotId==='netkeiba-tenno-17-reviewed-20261028-v1');
 const s=validateExpectedRoster(expanded.record,Date.parse('2026-10-28T12:00:00Z'));
 assert.equal(original.record.runners.length,10);assert.equal(original.record.provider,'JRA');
 assert.equal(s.runners.length,17);assert.equal(new Set(s.runners.map(r=>r.horseName)).size,17);assert.equal(s.provider,'netkeiba');
 assert.ok(original.record.runners.every(r=>s.runners.some(x=>x.horseName===r.horseName&&x.age===r.age)));
 assert.equal(s.runners.filter(r=>!original.record.runners.some(x=>x.horseName===r.horseName)).length,7);
 assert.ok(s.runners.every(r=>r.horseNo===undefined&&r.frameNo===undefined));
 assert.match(s.sourceText,/出走未確定/);assert.match(s.sourceText,/2022104094/);
});
