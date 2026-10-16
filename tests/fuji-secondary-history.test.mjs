import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FUJI_EXPECTED_SOURCE} from '../src/expected-runner-preview-v3.30.0.js';
import {FUJI_HISTORY_ROWS,FUJI_HISTORY_SOURCE_URL,FUJI_HISTORY_OBSERVED_AT} from '../src/fuji-history-secondary-v3.49.29.js';
import {ingestExpectedHistory} from '../src/expected-history-snapshot-v3.30.0.js';

function database(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 const db={
  prepare(query){queries.push(query);const statement=sql.prepare(query);return{bind(...args){return{run:async()=>statement.run(...args),all:async()=>({results:statement.all(...args)})}},run:async()=>statement.run()};},
  batch:async statements=>Promise.all(statements.map(statement=>statement.run()))
 };
 return{sql,db,queries};
}

test('Fuji secondary history persists only the verified runner under its own source snapshot',async()=>{
 assert.equal(FUJI_HISTORY_ROWS.length,4);
 assert.deepEqual([...new Set(FUJI_HISTORY_ROWS.map(row=>row.horse_name))],['シュガークン']);
 for(const row of FUJI_HISTORY_ROWS){
  assert.ok(row.race_date<FUJI_EXPECTED_SOURCE.date);
  assert.ok(row.last3f>0);
  assert.ok(FUJI_EXPECTED_SOURCE.names.includes(row.horse_name));
  assert.equal(row.source_url,FUJI_HISTORY_SOURCE_URL);
  assert.equal(row.observed_at,FUJI_HISTORY_OBSERVED_AT);
 }
 const {sql,db,queries}=database();
 await ingestExpectedHistory(db,FUJI_EXPECTED_SOURCE);
 await ingestExpectedHistory(db,FUJI_EXPECTED_SOURCE);
 const saved=sql.prepare('SELECT snapshot_id,horse_name,race_date,source_url,payload_json FROM lab_expected_history_snapshots ORDER BY race_date DESC').all();
 assert.equal(saved.length,4);
 assert.ok(saved.every(row=>row.snapshot_id===FUJI_EXPECTED_SOURCE.snapshotId&&row.horse_name==='シュガークン'&&row.source_url===FUJI_HISTORY_SOURCE_URL));
 assert.ok(saved.every(row=>JSON.parse(row.payload_json).source_url===FUJI_HISTORY_SOURCE_URL));
 const result=await ingestExpectedHistory(db,FUJI_EXPECTED_SOURCE);
 assert.equal(result.historyRows,4);
 assert.equal(result.snapshotId,FUJI_EXPECTED_SOURCE.snapshotId);
 assert.equal(result.officialTablesModified,false);
 assert.equal(result.scoreMutation,false);
 assert.equal(result.markMutation,false);
 assert.ok(queries.every(query=>query.includes('lab_expected_history_snapshots')));
 assert.ok(queries.every(query=>!/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:jra_past_performances|lab_user_mark)/i.test(query)));
 await assert.rejects(()=>ingestExpectedHistory(db,{...FUJI_EXPECTED_SOURCE,date:'2026-10-18'}),/対象一覧が更新/);
 sql.close();
});
