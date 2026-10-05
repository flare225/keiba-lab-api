import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{verifySealIdentity} from '../src/index-v3.8.4.js';

const HASH='a'.repeat(64);

test('seal identity accepts identical immutable hash with idempotent second call',()=>{
 const first={seal:{snapshotSha256:HASH,immutable:true}};
 const second={idempotent:true,immutable:true,seal:{snapshotSha256:HASH}};
 const v=verifySealIdentity(first,second);
 assert.equal(v.ok,true);
 assert.equal(v.sameHash,true);
 assert.equal(v.secondIdempotent,true);
});

test('seal identity rejects hash mismatch even when both calls claim immutable',()=>{
 const first={seal:{snapshotSha256:HASH,immutable:true}};
 const second={idempotent:true,immutable:true,seal:{snapshotSha256:'b'.repeat(64)}};
 const v=verifySealIdentity(first,second);
 assert.equal(v.ok,false);
 assert.equal(v.sameHash,false);
});

test('seal identity rejects a non-idempotent verification call',()=>{
 const first={seal:{snapshotSha256:HASH,immutable:true}};
 const second={immutable:true,seal:{snapshotSha256:HASH}};
 const v=verifySealIdentity(first,second);
 assert.equal(v.ok,false);
 assert.equal(v.secondIdempotent,false);
});

test('seal mode requires explicit LOCK confirmation before touching D1',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prelock-run?date=2099-10-10&venue=%E6%9D%B1%E4%BA%AC&race_no=11&track=%E8%89%AF&seal=1'),{},{});
 const d=await r.json();
 assert.equal(r.status,400);
 assert.match(d.error,/confirm=LOCK/);
});

test('explicit track is mandatory for orchestration',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prelock-run?date=2099-10-10&venue=%E6%9D%B1%E4%BA%AC&race_no=11'),{},{});
 const d=await r.json();
 assert.equal(r.status,400);
 assert.match(d.error,/explicit track/);
});

test('v3.8.4 deployment check exposes double-hash orchestrator build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});
 const d=await r.json();
 assert.equal(r.status,200);
 assert.equal(d.version,'3.8.4');
 assert.equal(d.build,'prelock-orchestrator-double-hash-verification');
});
