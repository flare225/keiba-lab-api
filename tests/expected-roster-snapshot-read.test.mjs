import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import app from '../src/index-v3.49.0.js';
import {saveExpectedRoster} from '../src/expected-roster-registry.js';
const stamp=Date.parse('2026-11-11T08:18:53Z');
const input={date:'2026-11-14',venue:'東京',raceNo:3,raceName:'2歳未勝利',provider:'netkeiba',kind:'expected-runners',sourceUrl:'https://own.netkeiba.com/race/shutuba.html?race_id=202605050303',observedAt:new Date(stamp).toISOString(),sourceText:'11/14東京3Rの部分名簿。原典でアルティシモ、イントゥーザブルー、エリステソーロを確認。',runners:['アルティシモ','イントゥーザブルー','エリステソーロ'].map(horseName=>({horseName,age:2})),rosterCoverage:{observedRunnerCount:3,declaredRunnerCount:13,complete:false}};
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const f=(a=[])=>({bind(...a){return f(a)},async first(){return sql.prepare(q).get(...a)},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return f()}};return{sql,db}}
const url=(sha,patch={})=>'https://test/v1/lab/expected-roster-snapshot?'+new URLSearchParams({date:input.date,venue:input.venue,race_no:'3',snapshot_sha256:sha,...patch});
const read=(db,sha,patch)=>app.fetch(new Request(url(sha,patch)),{DB:db},{});
test('witnessed partial roster GET returns exact immutable JSON for independent client SHA with one indexed SELECT',async()=>{
 const {sql,db}=fixture();const saved=await saveExpectedRoster(db,input,stamp);
 await saveExpectedRoster(db,{...input,sourceText:input.sourceText+' 新しい版',observedAt:new Date(stamp+1000).toISOString()},stamp+1000);
 const queries=[];const readonly={prepare(q){queries.push(q);assert.match(q,/^SELECT .*WHERE snapshot_id=\? AND race_key=\?/);return db.prepare(q)}};
 const response=await read(readonly,saved.snapshotId),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.available,true);assert.equal(body.snapshotSha256,saved.snapshotId);
 assert.equal(createHash('sha256').update(body.snapshotJson).digest('hex'),saved.snapshotId);
 assert.deepEqual(JSON.parse(body.snapshotJson),body.snapshot);assert.equal(body.snapshot.rosterCoverage.complete,false);assert.equal(body.snapshot.runners.length,3);
 assert.equal(createHash('sha256').update(body.snapshot.sourceText).digest('hex'),body.sourceSha256);
 assert.equal(body.formalCardSaved,false);assert.equal(body.guardrails.eligibleForProspectiveSeal,false);assert.equal(body.externalRequests,0);
 assert.equal(queries.length,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_expected_roster_registry').get().n,2);
 assert.equal(response.headers.get('cache-control'),'no-store');sql.close();
});
test('snapshot read rejects missing/invalid SHA before SQL and never falls back to another race or latest version',async()=>{
 const {sql,db}=fixture(),saved=await saveExpectedRoster(db,input,stamp);
 for(const sha of ['', 'bad', 'A'.repeat(64)]){const r=await read({prepare(){assert.fail('invalid SHA must not query')}},sha);assert.equal(r.status,409)}
 for(const patch of [{race_no:'4'},{venue:'京都'},{date:'2026-11-15'}]){const r=await read(db,saved.snapshotId,patch);assert.equal((await r.json()).available,false)}
 assert.equal((await (await read(db,'f'.repeat(64))).json()).available,false);
 const absent=await read({prepare(){return{bind(){return{async first(){throw Error('no such table: lab_expected_roster_registry')}}}}}},saved.snapshotId);assert.equal((await absent.json()).available,false);
 const limited=await read({prepare(){return{bind(){return{async first(){throw Error('D1 daily row read limit')}}}}}},saved.snapshotId);assert.equal(limited.status,409);assert.equal((await limited.json()).ok,false);
 sql.close();
});
test('corrupt JSON, source hash and race identity fail closed without returning a snapshot',async()=>{
 const {sql,db}=fixture(),saved=await saveExpectedRoster(db,input,stamp),row=sql.prepare('SELECT * FROM lab_expected_roster_registry').get();
 for(const patch of [{record_json:row.record_json+' '},{source_sha256:'f'.repeat(64)},{race_key:'2026-11-14:東京:4'}]){
  const fake={prepare(){return{bind(){return{async first(){return{...row,...patch}}}}}}};
  const r=await read(fake,saved.snapshotId),b=await r.json();assert.equal(r.status,409);assert.equal(b.ok,false);assert.equal(b.snapshot,undefined);
 }
 const response=await app.fetch(new Request(url(saved.snapshotId),{method:'POST'}),{DB:{prepare(){assert.fail('snapshot POST must not query')}}},{});assert.equal(response.status,405);sql.close();
});
