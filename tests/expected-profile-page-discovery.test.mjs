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
test('D1 quota during profile-page persistence or readback stops all further SQL and preserves the lease',async()=>{
 for(const phase of ['save','readback','error-receipt'])for(const kind of ['flag','message']){
  const {db,sql}=fixture();let tripped=false,requests=0;const after=[];
  const failure=Error(kind==='message'?'D1_ERROR: exceeded D1 database daily row read limit':'budget exhausted');if(kind==='flag')failure.d1DailyReadLimit=true;
  const wrapped={prepare(q){
   if(tripped){after.push(q);throw Error('SQL executed after D1 quota');}
   const f=(args=[])=>({bind(...args){return f(args)},async first(){
    if(phase==='readback'&&q.startsWith('SELECT page_url')){tripped=true;throw failure;}
    return db.prepare(q).bind(...args).first();
   },async run(){
    if(phase!=='readback'&&q.startsWith('INSERT OR REPLACE INTO lab_expected_profile_pages')){tripped=true;throw failure;}
    return db.prepare(q).bind(...args).run();
   }});return f();
  }};
  await assert.rejects(discoverExpectedProfilePage(wrapped,source,{now:()=>stamp,fetcher:async()=>{requests++;return phase==='error-receipt'?new Response('',{status:403}):new Response('<a href="/keiba/race/097/horse.html">出走馬情報</a>',{headers:{'content-type':'text/html; charset=utf-8'}})}}),e=>e===failure);
  assert.deepEqual(after,[]);assert.equal(requests,1);
  const gate=sql.prepare('SELECT locked_until,next_batch_at FROM lab_history_collection_budget').get();assert.equal(gate.locked_until,stamp+120000);assert.equal(gate.next_batch_at,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM lab_expected_profile_pages').get().n,phase==='readback'?1:0);sql.close();
 }
});
