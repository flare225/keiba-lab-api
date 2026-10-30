import test from 'node:test';import assert from 'node:assert/strict';
import app from '../src/index-v3.49.0.js';
import {runSharedPageStep,parseSharedPage} from '../src/shared-page-acquisition.js';
import {readSharedPageEvidence} from '../src/shared-page-evidence.js';
import {sha256} from '../src/card-evidence.js';
import {fixtureDatabase,racesFixture,FIXTURE_STAMP,SCOPE,calendar,INDEX} from './helpers/shared-page-fixture.mjs';
// Synthetic supported-page overflow remains rejected after the observed real navigation fix.
const html='<title>Synthetic navigation overflow</title>'+Array.from({length:270},(_,i)=>`<a href="https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dtest${i}/AA">page</a>`).join('')+`<a href="${INDEX}">index</a>`;
async function fixture(){const f=await fixtureDatabase(),r=racesFixture()[0];const fail=await runSharedPageStep(f.db,{scope:SCOPE,races:[r]},{now:()=>FIXTURE_STAMP,fetcher:async()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})});assert.equal(fail.bodyStored,true);assert.equal(fail.error,'Published-link bound exceeded');f.reset();return{...f,r};}
test('exact saved failed shared page can be diagnosed without fetching, reparsing into the queue or changing its bounds',async()=>{
 const {db,sql,stats,r}=await fixture();const before=sql.prepare('SELECT * FROM lab_shared_page_receipts_v1').get();const result=await readSharedPageEvidence(db,{scope:SCOPE,pageUrl:calendar(r.date),includeBody:true});
 assert.equal(result.integrityVerified,true);assert.equal(result.bodyHtml,html);assert.equal(result.bodySha256,await sha256(html));assert.equal(result.extractedLinkCount,271);assert.equal(result.supportedUniquePageCount,271);assert.equal(result.otherLinkCount,0);assert.equal(result.existingParserWouldReject,true);assert.equal(result.findingsWritten,false);assert.equal(result.externalRequests,0);assert.equal(stats.statements,1);assert.ok(stats.executed.every(q=>q.startsWith('SELECT')));assert.throws(()=>parseSharedPage(html,calendar(r.date)),/bound exceeded/);assert.deepEqual(sql.prepare('SELECT * FROM lab_shared_page_receipts_v1').get(),before);
 assert.equal((await readSharedPageEvidence(db,{scope:'2026-10-24',pageUrl:calendar(r.date)})).available,false);sql.exec("UPDATE lab_shared_page_receipts_v1 SET body_sha='missing'");await assert.rejects(readSharedPageEvidence(db,{scope:SCOPE,pageUrl:calendar(r.date)}),/body is missing/);sql.close();
});
test('explicit shared-source GET requires exact scope and published JRA URL before one SELECT; it never accepts a write',async()=>{
 const {db,sql,stats,reset,r}=await fixture();const u=new URL('https://test/v1/lab/shared-page-evidence');for(const [k,v]of Object.entries({confirm:'READ_STORED_SOURCE',scope:SCOPE,page_url:calendar(r.date)}))u.searchParams.set(k,v);
 const res=await app.fetch(new Request(u),{DB:db},{}),j=await res.json();assert.equal(res.status,200);assert.equal(j.bodyHtml,undefined);assert.equal(j.metrics.queries,1);assert.equal(j.integrityVerified,true);assert.equal(res.headers.get('cache-control'),'no-store');reset();
 assert.equal((await app.fetch(new Request(u,{method:'POST'}),{DB:db},{})).status,405);u.searchParams.delete('scope');assert.equal((await app.fetch(new Request(u),{DB:db},{})).status,409);u.searchParams.set('scope',SCOPE);u.searchParams.set('page_url','https://evil.test/');assert.equal((await app.fetch(new Request(u),{DB:db},{})).status,409);assert.equal(stats.statements,0);sql.close();
});

test('validated literal CNAME receipt is readable through either separator without writes',async()=>{
 const {db,sql,stats,reset}=await fixtureDatabase();
 const literal='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604100120261031/74', encoded=literal.replace('/74','%2F74'), body='<title>Saved card</title>', hash=await sha256(body);
 sql.prepare('INSERT INTO lab_shared_page_receipts_v1(scope_key,page_url,status,next_at,body_sha) VALUES(?,?,?,?,?)').run(SCOPE,literal,'formal-saved',0,hash);
 sql.prepare('INSERT INTO lab_shared_page_bodies_v1(scope_key,page_url,sha256,body_html,byte_length,observed_at) VALUES(?,?,?,?,?,?)').run(SCOPE,literal,hash,body,new TextEncoder().encode(body).length,FIXTURE_STAMP);
 reset();for(const pageUrl of [literal,encoded]){const r=await readSharedPageEvidence(db,{scope:SCOPE,pageUrl,includeBody:true});assert.equal(r.integrityVerified,true);assert.equal(r.bodySha256,hash);assert.equal(r.bodyHtml,body);}
 assert.ok(stats.executed.every(q=>q.startsWith('SELECT')));assert.equal((await readSharedPageEvidence(db,{scope:'2026-10-24',pageUrl:encoded})).available,false);
 sql.exec("UPDATE lab_shared_page_receipts_v1 SET body_sha='wrong'");await assert.rejects(readSharedPageEvidence(db,{scope:SCOPE,pageUrl:encoded}),/body is missing/);sql.close();
});
