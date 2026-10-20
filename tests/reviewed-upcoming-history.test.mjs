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
