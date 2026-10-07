import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MAIN_EXPECTED_SOURCE,historyForExpected} from '../src/expected-runner-preview-v3.30.0.js';
import {ingestExpectedHistory} from '../src/expected-history-snapshot-v3.30.0.js';
import {IRELAND_HISTORY_ROWS} from '../src/expected-history-snapshot-v3.48.0.js';
test('Ireland verified snapshot covers 18 horses and 80 actual starts, excludes rest and excluded Queen start',()=>{
 assert.equal(IRELAND_HISTORY_ROWS.length,80);assert.equal(new Set(IRELAND_HISTORY_ROWS.map(r=>r.horse_name)).size,18);
 assert.equal(IRELAND_HISTORY_ROWS.filter(r=>r.horse_name==='クイーンズウォーク').length,3);
 for(const r of IRELAND_HISTORY_ROWS){assert.ok(MAIN_EXPECTED_SOURCE.names.includes(r.horse_name));assert.ok(r.race_date<MAIN_EXPECTED_SOURCE.date);assert.ok(r.last3f>0);assert.ok(r.finish_position<=r.field_size);}
});
test('supplement ingest is idempotent and enriches preview without writing official histories or predictions',async()=>{
 const sql=new DatabaseSync(':memory:');const queries=[];
 const db={prepare(q){queries.push(q);const stmt=sql.prepare(q);return{bind(...a){return{run:async()=>stmt.run(...a),all:async()=>({results:stmt.all(...a)})}},run:async()=>stmt.run()}},batch:async ss=>Promise.all(ss.map(s=>s.run()))};
 await ingestExpectedHistory(db,MAIN_EXPECTED_SOURCE);await ingestExpectedHistory(db,MAIN_EXPECTED_SOURCE);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_history_snapshots').get().n,80);
 for(const q of queries)assert.match(q,/lab_expected_history_snapshots/);
 const r=await historyForExpected(db,MAIN_EXPECTED_SOURCE,'ヴォンフレ');assert.equal(r.summary.storedStarts,5);assert.equal(r.summary.last3fRecorded,5);assert.ok(r.recent.every(x=>x.supplementalSourceUrl));
 await assert.rejects(()=>ingestExpectedHistory(db,{...MAIN_EXPECTED_SOURCE,date:'2026-05-01'}),/検証/);
 sql.close();
});
