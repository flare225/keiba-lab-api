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
