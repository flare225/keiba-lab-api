import test from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{discoverExpectedProfilePage,readExpectedProfilePage}from'../src/expected-profile-page-discovery.js';import{ensureCollectionTables}from'../src/history-collection-v3.37.0.js';
const source={snapshotId:'registered:artemis',officialRacePage:'https://www.jra.go.jp/keiba/race/097.html'},stamp=Date.parse('2026-10-19T09:00:00Z');
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(q){const f=(a=[])=>({bind(...a){return f(a)},async first(){return sql.prepare(q).get(...a)||null},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return f()}};return{db,sql}}
test('follows only published matching JRA horse-page links and persists no horse history',async()=>{
 const{db,sql}=fixture();let requests=0;const r=await discoverExpectedProfilePage(db,source,{now:()=>stamp,fetcher:async u=>{requests++;assert.equal(u,source.officialRacePage);return new Response('<a href="https://attacker.invalid/keiba/race/097/horse.html">bad</a><a href="/keiba/race/098/horse.html">other</a><a href="/keiba/race/097/horse.html">出走馬情報</a>',{headers:{'content-type':'text/html; charset=utf-8'}})}});
 assert.equal(r.status,'profile-page-discovered');assert.equal(requests,1);assert.equal(r.historyRowsSaved,0);assert.equal(r.profileLinksFound,0);assert.equal(await readExpectedProfilePage(db,source),'https://www.jra.go.jp/keiba/race/097/horse.html');sql.close();
});
test('no published link is not guessed and discovery cooldown is respected',async()=>{
 const{db,sql}=fixture();const r=await discoverExpectedProfilePage(db,source,{now:()=>stamp,fetcher:async()=>new Response('<p>未掲載</p>')});assert.equal(r.pageUrl,null);assert.equal(await readExpectedProfilePage(db,source),null);const again=await discoverExpectedProfilePage(db,source,{now:()=>stamp+60000,fetcher:()=>assert.fail('do not retry unavailable page')});assert.equal(again.externalRequests,0);sql.close();
});
test('shared future gate blocks fetch and 403 extends same global gate for an hour',async()=>{
 const{db,sql}=fixture();await ensureCollectionTables(db);sql.prepare("UPDATE lab_history_collection_budget SET next_batch_at=?").run(stamp+60000);let calls=0;
 const deps={now:()=>stamp,fetcher:async()=>{calls++;return new Response('',{status:403})}};assert.equal((await discoverExpectedProfilePage(db,source,deps)).status,'cooldown');assert.equal(calls,0);sql.prepare('UPDATE lab_history_collection_budget SET next_batch_at=0').run();const r=await discoverExpectedProfilePage(db,source,deps);assert.match(r.error,/403/);assert.equal(calls,1);assert.equal(sql.prepare('SELECT next_batch_at FROM lab_history_collection_budget').get().next_batch_at,stamp+3600000);sql.close();
});
