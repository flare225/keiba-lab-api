import test from 'node:test';import assert from 'node:assert/strict';
import {jraPageRequest,isJraSourceBlocked} from '../src/jra-page-request.js';
test('published database URLs become form POST without guessing identities or hosts',()=>{
 const r=jraPageRequest('https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002023123456%2FAA');
 assert.equal(r.url,'https://www.jra.go.jp/JRADB/accessU.html');assert.equal(r.options.method,'POST');
 assert.equal(new URLSearchParams(r.options.body).get('CNAME'),'pw01dud002023123456/AA');
 assert.equal(jraPageRequest('https://www.jra.go.jp/news/').options.method,'GET');
 assert.throws(()=>jraPageRequest('https://example.com/JRADB/accessU.html?CNAME=x'));
 for(const n of [403,429,503])assert.equal(isJraSourceBlocked(n),true);
 assert.equal(isJraSourceBlocked(200),false);
});

test('published official race cards use the accessD form action',()=>{
 const u='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0104202604021120261018/AA';
 const r=jraPageRequest(u);assert.equal(r.options.method,'POST');assert.equal(r.url,'https://www.jra.go.jp/JRADB/accessD.html');assert.equal(new URLSearchParams(r.options.body).get('CNAME'),new URL(u).searchParams.get('CNAME'));
});
