import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {EXPECTED_SOURCES,validatePreview,historyForExpected,expectedRunnerPreview} from '../src/expected-runner-preview-v3.30.0.js';
import {expectedPreviewPage} from '../src/expected-preview-page-v3.30.0.js';
const source=EXPECTED_SOURCES[0];
const input={date:source.date,venue:source.venue,raceNo:source.raceNo,phase:'initial',marks:[{horseName:'デミアン',mark:'◎'}]};
function db(profiles=[],rich=[],failure){return {prepare(sql){assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|odds|popularity)\b/i);return{bind(...args){assert.equal(args.at(-1),source.date);return{async all(){if(failure)throw Error(failure);return{results:sql.includes('lab_expected_history_snapshots')?[]:sql.includes('FROM jra_past_performances')?profiles:rich}}}}}}}}
test('latest snapshot validates names and preserves human marks without horse numbers',()=>{
 assert.equal(source.names.length,12);assert.ok(source.names.includes('ライーリーアース'));assert.ok(!source.names.includes('レゾルーティオ'));
 assert.deepEqual(validatePreview(input).marks,[{horseName:'デミアン',mark:'◎',horseNo:null}]);
 for(const change of [{phase:'final'},{sourceSnapshotId:'old'},{marks:[{horseName:'デミアン',mark:'◎',horseNo:1}]},{marks:[{horseName:'別馬',mark:'◎'}]},{marks:[...input.marks,...input.marks]}])assert.throws(()=>validatePreview({...input,...change}));
});
test('merges DB sources, retains last3f and excludes target/future/older identities',async()=>{
 const row={race_date:'2026-09-01',venue:'東京',race_name:'新馬',surface:'芝',distance:1600,finish_position:1,time_text:'1:35.2',last3f:33.4};
 const history=await historyForExpected(db([row,{...row,race_date:source.date},{...row,race_date:'2025-09-01'},{...row,race_date:'2026-10-11'}],[{...row,last3f:33.2}]),source,'デミアン');
 assert.equal(history.recent.length,1);assert.equal(history.recent[0].timeSeconds,95.2);assert.equal(history.summary.avgLast3f,33.2);assert.equal(history.summary.wins,1);assert.equal(history.fromDate,'2026-01-01');
});
test('missing data remains unknown; query failures never become zero starts',async()=>{
 const history=await historyForExpected(db([{race_date:'2026-09-01',venue:'東京'}]),source,'デミアン');
 assert.equal(history.summary.wins,null);assert.equal(history.summary.avgLast3f,null);assert.ok(history.warnings.includes('last3f-incomplete'));
 await assert.rejects(()=>historyForExpected(db([],[],'timeout'),source,'デミアン'),/履歴ゼロとは判定していません/);
 const missing=await historyForExpected(db([],[],'no such table: jra_past_performances'),source,'デミアン');assert.equal(missing.available,false);assert.ok(missing.warnings.includes('stored-profile-history-table-unavailable'));
});
test('conflicting identity suppresses comparison',async()=>{
 const row={race_date:'2026-09-01',venue:'東京',finish_position:1};
 const history=await historyForExpected(db([row],[{...row,finish_position:9}]),source,'デミアン');
 assert.equal(history.available,false);assert.equal(history.summary,null);assert.deepEqual(history.recent,[]);
});
test('preview is read-only and keeps source provenance and marks',async()=>{
 const result=await expectedRunnerPreview(db(),input);
 assert.equal(result.source.provider,'netkeiba');assert.equal(result.source.dynamicRefresh,false);assert.equal(result.audit.marked[0].mark,'◎');assert.equal(result.audit.marked[0].laboScore,null);assert.equal(result.guardrails.scoreMutation,false);assert.equal(result.guardrails.eligibleForProspectiveSeal,false);
});
test('browser page lists all expected runners and its inline script compiles',()=>{
 const html=expectedPreviewPage();
 for(const name of source.names)assert.ok(html.includes(name));
 assert.ok(html.includes('/v1/lab/expected-runner-preview'));
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length);for(const [,code] of scripts)new Script(code);
});

import {EXPECTED_HISTORY_ROWS,ingestExpectedHistory} from '../src/expected-history-snapshot-v3.30.0.js';
test('verified history seed covers all twelve, has last3f and cannot write official tables',async()=>{
 assert.equal(new Set(EXPECTED_HISTORY_ROWS.map(r=>r.horse_name)).size,12);
 assert.equal(EXPECTED_HISTORY_ROWS.length,18);
 for(const row of EXPECTED_HISTORY_ROWS){assert.ok(row.race_date<source.date);assert.ok(row.last3f>0);assert.ok(source.names.includes(row.horse_name))}
 const queries=[]; const fake={prepare(sql){queries.push(sql);return{run:async()=>{},bind(){return this}}},batch:async statements=>{assert.equal(statements.length,18)}};
 const result=await ingestExpectedHistory(fake,source);assert.equal(result.officialTablesModified,false);
 for(const sql of queries)assert.match(sql,/lab_expected_history_snapshots/);
});
