import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {postRaceHistoryBatch} from '../src/post-race-history-batch.js';
test('bounded detail prefilter retains date boundaries, duplicates and evidence order while scanning the stored table once',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE lab_prior_detail_evidence(detail_json TEXT,result_url TEXT,fetched_at TEXT)');
 const insert=sql.prepare('INSERT INTO lab_prior_detail_evidence VALUES(?,?,?)');
 for(let i=0;i<2000;i++)insert.run(JSON.stringify({horseName:'unrelated'+i,date:'2025-01-01'}),'irrelevant','2025');
 for(const [name,date,stamp] of [['A','2024-01-01','2'],['A','2025-02-01','1'],['A','2025-02-01','3'],['A','2026-10-24','4'],['B','2025-02-01','5'],['B','2023-12-31','6']])insert.run(JSON.stringify({horseName:name,date}),name+stamp,stamp);
 let detailSql,detailArgs;const db={prepare(q){const w=(args=[])=>({bind(...a){return w(a)},async all(){if(q.includes('selected_details')){detailSql=q;detailArgs=args;}return{results:sql.prepare(q).all(...args)}}});return w()}};
 const context={date:'2026-10-24',raceKey:'2026-10-24:東京:1',runners:[{horse_name:'A',age:4},{horse_name:'B',age:4}]};
 const actual=await postRaceHistoryBatch(db,context);
 const old=sql.prepare("SELECT d.result_url,d.detail_json,json_extract(d.detail_json,'$.horseName') horse_name FROM json_each(?) e JOIN lab_prior_detail_evidence d ON json_extract(d.detail_json,'$.horseName')=json_extract(e.value,'$.horseName') WHERE json_extract(d.detail_json,'$.date')>=json_extract(e.value,'$.fromDate') AND json_extract(d.detail_json,'$.date')<? ORDER BY d.fetched_at").all(detailArgs[0],context.date);
 for(const name of ['A','B'])assert.deepEqual(actual.get(name).detailEvidence,old.filter(x=>x.horse_name===name));
 const plan=sql.prepare('EXPLAIN QUERY PLAN '+detailSql).all(...detailArgs).map(x=>x.detail);
 assert.ok(plan.some(x=>x.includes('MATERIALIZE selected_details')));assert.equal(plan.filter(x=>x.includes('SCAN lab_prior_detail_evidence')).length,1);assert.equal(actual.get('A').detailEvidence.length,3);assert.equal(actual.get('B').detailEvidence.length,1);sql.close();
});
