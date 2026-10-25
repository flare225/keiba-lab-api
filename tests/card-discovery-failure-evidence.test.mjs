import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discoverExpectedCard,cardDiscoveryFailureEvidence} from '../src/expected-card-discovery.js';
import {runPipelineJob,pipelineStatus} from '../src/pipeline-runs-v3.40.0.js';
import {sha256} from '../src/card-evidence.js';
const stamp=Date.parse('2026-10-23T13:18:49Z'),index='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3';
const source={date:'2026-10-24',venue:'京都',raceNo:1,snapshotId:'official-card:2026-10-24:京都:1:official-program',officialRosterDiscoveryUrl:index};
// Synthetic navigation reproduces the unsupported-middle-page condition.
// It is not a capture of the production JRA response.
const middle='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dle2026102408/AA';
const html=`<p>隔離fixture</p><a onclick="doAction('/JRADB/accessD.html','pw01dle2026102408/AA')">開催一覧</a>`;
function fixture(){const sql=new DatabaseSync(':memory:'),queries=[];const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async first(){queries.push(q);return sql.prepare(q).get(...a)||null},async all(){queries.push(q);return{results:sql.prepare(q).all(...a)}},async run(){queries.push(q);const r=sql.prepare(q).run(...a);return{meta:{changes:Number(r.changes)}}}});return w()}};return{db,sql,queries};}
const response=body=>new Response(body,{headers:{'content-type':'text/html;charset=utf-8'}});
test('existing failure exposes discarded middle link, exact body SHA and HTTP through saved pipeline readback',async()=>{
 const {db,sql}=fixture();let calls=0;
 const result=await runPipelineJob(db,'history','scheduled',()=>discoverExpectedCard(db,source,{now:()=>stamp,fetcher:async()=>{calls++;return response(html)}}),{now:()=>stamp,scheduledTime:stamp});
 assert.equal(result.status,'failed');assert.equal(calls,1);assert.equal(result.failureEvidence.httpStatus,200);assert.equal(result.failureEvidence.bodySha256,await sha256(html));assert.equal(new URL(result.failureEvidence.linkSamples[0].url).searchParams.get('CNAME'),new URL(middle).searchParams.get('CNAME'));assert.equal(result.failureEvidence.linkSamples[0].reason,'unhandled-navigation');assert.equal(result.failureEvidence.fullBodyIncluded,true);
 const restored=await new Response(new Blob([Uint8Array.from(atob(result.failureEvidence.bodyGzipBase64),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();assert.equal(restored,html);assert.equal(await sha256(restored),result.failureEvidence.bodySha256);
 const saved=(await pipelineStatus(db,stamp)).jobs.find(j=>j.job==='history').scheduled.result;
 assert.deepEqual(saved.failureEvidence,result.failureEvidence);assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('jra_races','lab_automatic_predictions_v1')").get().n,0);sql.close();
});
test('evidence is bounded, explains target mismatch and does not claim an excerpt reproduces full HTML',async()=>{
 const wrong='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604081120261025/AA';
 let state=314159265;const noise=Array.from({length:20000},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0).toString(16).padStart(8,'0')}).join('');
 const body='<p>'+ noise+'</p>'+Array.from({length:300},(_,i)=>`<a href="${wrong}&sample=${i}">別対象</a>`).join('');
 const r=await cardDiscoveryFailureEvidence(body,index,source,{httpStatus:200,observedAt:new Date(stamp).toISOString(),charset:'utf-8',receivedBytes:Buffer.byteLength(body)});
 assert.equal(r.parsedLinkCount,300);assert.equal(r.linkCounts['other-date'],300);assert.equal(r.samplesTruncated,true);assert.equal(r.fullBodyIncluded,false);assert.equal(r.hashBasis,'complete-decoded-html-utf8');assert.notEqual(await sha256(r.excerpt),r.bodySha256);assert.ok(Buffer.byteLength(JSON.stringify(r))<=8192);assert.ok(Buffer.byteLength(r.excerpt)<=1024);
});
test('diagnostic failure adds no SQL statements or external requests compared with existing link discovery',async()=>{
 const runs=[];for(const body of [html,'<a href="https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604080120261024/AA">対象</a>']){const f=fixture();let calls=0;const result=await discoverExpectedCard(f.db,source,{now:()=>stamp,fetcher:async()=>{calls++;return response(body)}});runs.push({queries:f.queries.length,calls,status:result.status});f.sql.close();}
 assert.equal(runs[0].status,'failed');assert.equal(runs[1].status,'official-card-link-found');assert.equal(runs[0].queries,runs[1].queries);assert.equal(runs[0].calls,1);assert.equal(runs[1].calls,1);
});
test('403 retains one-hour gate and a held gate prevents another source request',async()=>{
 const {db,sql}=fixture();let calls=0;const deps={now:()=>stamp,fetcher:async()=>{calls++;return new Response('',{status:403})}};
 const r=await discoverExpectedCard(db,source,deps);assert.match(r.error,/403/);assert.equal(r.failureEvidence,undefined);assert.equal(sql.prepare("SELECT next_batch_at FROM lab_history_collection_budget WHERE name='jra-history'").get().next_batch_at,stamp+3600000);
 const again=await discoverExpectedCard(db,source,deps);assert.equal(again.externalRequests,0);assert.equal(calls,1);sql.close();
});

test('unhandled intermediate navigation is retained ahead of unrelated site menus',async()=>{
 const page=Array.from({length:100},(_,i)=>`<a href="/news/menu${i}.html">menu</a>`).join('')+html;const r=await cardDiscoveryFailureEvidence(page,index,source,{httpStatus:200,observedAt:new Date(stamp).toISOString(),charset:'utf-8',receivedBytes:Buffer.byteLength(page)});assert.equal(r.linkCounts['non-card-link'],100);assert.equal(r.linkSamples[0].reason,'unhandled-navigation');assert.ok(Buffer.byteLength(JSON.stringify(r))<=8192);
});

test('oversized card evidence retains the failing runner cells instead of only the document head',async()=>{
 let seed=314159265;const noise=Array.from({length:20000},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0).toString(16).padStart(8,'0')}).join('');
 const url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604080120261024/AA',body='<head>'+noise+'</head><table><tr><td class="waku">1</td><td class="num">1</td><td class="horse"><a>テスト馬</a>父：テスト 母：テスト</td><td class="jockey">年齢欠損 55kg 山田</td></tr></table>';
 const r=await cardDiscoveryFailureEvidence(body,url,source,{httpStatus:200,observedAt:new Date(stamp).toISOString()});
 assert.equal(r.fullBodyIncluded,false);assert.equal(r.cardInspection.sourceRowCount,1);assert.equal(r.cardInspection.parsedRunnerCount,0);assert.match(r.cardInspection.problemRows[0].connectionCell,/年齢欠損/);assert.match(r.cardInspection.problemRows[0].horseCell,/テスト馬/);assert.equal(r.bodySha256,await sha256(body));assert.ok(Buffer.byteLength(JSON.stringify(r))<=8192);
});
