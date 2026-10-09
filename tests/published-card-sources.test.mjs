import test from 'node:test';import assert from 'node:assert/strict';
import {publishedCardSources} from '../src/index-v3.7.1.js';
const date='2026-10-11',programs=[{venue:'東京',race_no:11}],url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604041120261011/CE';
const db=row=>({prepare(){return{bind(){return{async first(){return row?{...row,runners_json:'[]'}:null;}}}}}});
test('reuse witnessed pre-draw URL without fetching blocked index; source still needs fresh card parsing',async()=>{
 let calls=0;const r=await publishedCardSources(db({source_url:url,source_sha256:'verified-hash'}),date,programs,async()=>{calls++;throw Error('blocked index');});assert.equal(calls,0);assert.equal(r.pagesVisited,0);assert.equal(r.found.get(date+':東京:11').url,url);
});
test('wrong race, unverified source and non-JRA URL fall back to published-link discovery',async()=>{
 for(const row of [null,{source_url:url},{source_url:url.replace('www.jra.go.jp','example.com'),source_sha256:'hash'},{source_url:url.replace('20261011','20261010'),source_sha256:'hash'}]){
 let calls=0;const r=await publishedCardSources(db(row),date,programs,async(d,p)=>{calls++;assert.equal(p.length,1);return{found:new Map(),errors:[]};});assert.equal(calls,1);assert.equal(r.found.size,0);
 }
});
