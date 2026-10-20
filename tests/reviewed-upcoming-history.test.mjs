import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {importReviewedUpcomingHistory,readReviewedUpcomingHistory} from '../src/reviewed-upcoming-history.js';
import {EXPECTED_ROSTER_SEEDS} from '../src/expected-roster-seeds.js';
import {saveExpectedRoster,storedExpectedSources} from '../src/expected-roster-registry.js';
import {historyForExpected} from '../src/expected-runner-preview-v3.30.0.js';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async all(){return{results:sql.prepare(q).all(...a)}},async first(){return sql.prepare(q).get(...a)||null},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return w()},async batch(ss){return Promise.all(ss.map(s=>s.run()))}};return{db,sql}}
test('reviewed public facts for all 21 registered horses persist 63 rows and independently read back without official table writes',async()=>{
 const {db,sql}=fixture();await saveExpectedRoster(db,EXPECTED_ROSTER_SEEDS[0].record,Date.parse('2026-10-20T00:00:00Z'));const [source]=await storedExpectedSources(db,'2026-10-25','2026-10-25');
 const saved=await importReviewedUpcomingHistory(db,source);assert.equal(saved.savedRows,63);assert.equal(saved.storedRows,63);assert.equal(saved.horses.length,21);assert.ok(saved.horses.every(h=>h.storedRows===3&&h.last3fRows===3));assert.equal(saved.officialTablesModified,false);assert.equal(saved.learningCandidateRegistered,false);
 const read=await readReviewedUpcomingHistory(db,source);assert.equal(read.sha256,saved.sha256);assert.equal(read.integrityVerified,true);assert.equal((await importReviewedUpcomingHistory(db,source)).savedRows,0);
 const history=await historyForExpected(db,{...source,surface:'芝',distance:3000},'アルトラムス');assert.equal(history.recent.length,3);assert.ok(history.recent.every(r=>r.date<'2026-10-25'&&r.dbSource==='netkeiba-dated-history'));assert.equal(history.recent[0].last3f,33.5);
 await assert.rejects(importReviewedUpcomingHistory(db,{...source,names:source.names.slice(1)}),/一致/);sql.exec("UPDATE lab_expected_history_snapshots SET payload_json='{}' WHERE horse_name='アルトラムス'");await assert.rejects(readReviewedUpcomingHistory(db,source),/一致/);sql.close();
});
test('Artemis 14 horses retain actual one-to-three starts and provincial turf provenance',async()=>{
 const {db,sql}=fixture();await saveExpectedRoster(db,EXPECTED_ROSTER_SEEDS[1].record,Date.parse('2026-10-20T00:00:00Z'));const [source]=await storedExpectedSources(db,'2026-10-24','2026-10-24');const saved=await importReviewedUpcomingHistory(db,source);assert.equal(saved.savedRows,22);assert.equal(saved.horses.length,14);assert.equal(saved.horses.find(h=>h.horseName==='カナデルペガサス').storedRows,1);assert.equal(saved.horses.find(h=>h.horseName==='ベストプラージュ').storedRows,3);assert.equal((await readReviewedUpcomingHistory(db,source)).sha256,saved.sha256);const r=sql.prepare("SELECT payload_json FROM lab_expected_history_snapshots WHERE horse_name='ベストプラージュ' ORDER BY race_date DESC").all();assert.ok(r.every(x=>JSON.parse(x.payload_json).venue==='盛岡'));sql.close();
});

test('Niigata 22-horse roster and 65 supported domestic starts persist and feed DB history',async()=>{
 const {db,sql}=fixture(),seed=EXPECTED_ROSTER_SEEDS.find(s=>s.record.venue==='新潟');await saveExpectedRoster(db,seed.record,Date.parse('2026-10-20T02:00:00Z'));const [source]=await storedExpectedSources(db,'2026-10-25','2026-10-25');
 const saved=await importReviewedUpcomingHistory(db,source);assert.equal(saved.savedRows,65);assert.equal(saved.horses.length,22);assert.equal(saved.horses.find(h=>h.horseName==='アメリカンステージ').storedRows,2);assert.ok(saved.horses.every(h=>h.last3fRows===h.storedRows));assert.equal((await readReviewedUpcomingHistory(db,source)).sha256,saved.sha256);assert.equal((await importReviewedUpcomingHistory(db,source)).savedRows,0);
 const h=await historyForExpected(db,{...source,surface:'芝',distance:1000},'ロードトレイル');assert.equal(h.recent.length,3);assert.equal(h.recent[0].last3f,32);assert.equal(h.recent[0].date,'2026-08-02');
 await assert.rejects(importReviewedUpcomingHistory(db,{...source,ages:{...source.ages,'クムシラコ':3}}),/一致/);sql.close();
});

test('Niigata 9R and 10R verified latest histories persist 69 and 42 rows and expose exact readback facts',async()=>{
 for(const [raceNo,count,total] of [[9,23,69],[10,14,42]]){const {db,sql}=fixture(),seed=EXPECTED_ROSTER_SEEDS.find(s=>s.record.venue==='新潟'&&s.record.raceNo===raceNo);await saveExpectedRoster(db,seed.record,Date.parse('2026-10-20T03:00:00Z'));const [source]=await storedExpectedSources(db,'2026-10-25','2026-10-25');const saved=await importReviewedUpcomingHistory(db,source);assert.equal(saved.savedRows,total);assert.equal(saved.horses.length,count);assert.equal(saved.rows.length,total);assert.ok(saved.horses.every(h=>h.storedRows===3&&h.last3fRows===3));assert.ok(saved.rows.every(r=>r.race_date<source.date&&r.corner_positions&&r.last3f>0));assert.equal((await readReviewedUpcomingHistory(db,source)).sha256,saved.sha256);assert.equal((await importReviewedUpcomingHistory(db,source)).savedRows,0);sql.close();}
});
test('three additional races persist 146 supported starts while retaining one non-finish omission',async()=>{
 const {ADDITIONAL_WEEK_REVIEWED}=await import('../src/additional-week-reviewed-history.js');
 for(const c of ADDITIONAL_WEEK_REVIEWED){const {db,sql}=fixture(),t=c.seed.record;await saveExpectedRoster(db,t,Date.parse('2026-10-20T03:10:00Z'));const [source]=await storedExpectedSources(db,t.date,t.date);const saved=await importReviewedUpcomingHistory(db,source);assert.equal(saved.savedRows,c.rows.length);assert.equal(saved.horses.length,t.runners.length);assert.equal(saved.rows.length,c.rows.length);assert.ok(saved.rows.every(r=>r.race_date<t.date&&r.finish_position>=1&&r.last3f>0));assert.equal((await readReviewedUpcomingHistory(db,source)).sha256,saved.sha256);assert.equal((await importReviewedUpcomingHistory(db,source)).savedRows,0);
 if(t.raceName==='魚沼ステークス'){assert.equal(saved.omittedStarts.length,1);assert.equal(saved.horses.find(h=>h.horseName==='フクノブルーレイク').storedRows,2);assert.ok(!saved.rows.some(r=>r.horse_name==='フクノブルーレイク'&&r.race_date==='2026-08-22'));}else assert.equal(saved.omittedStarts.length,0);
 sql.close();}
});
