import test from 'node:test';
import assert from 'node:assert/strict';
import {readStatusCache,statusCacheKey,STATUS_CACHE_SECONDS,writeStatusCache} from '../src/status-read-cache.js';

test('only selected GET status routes receive a cache key',()=>{
 const get=(path,method='GET')=>statusCacheKey(new Request('https://api.test'+path,{method}));
 assert.ok(get('/v1/lab/expected-history-status'));
 assert.ok(get('/v1/lab/pipeline-status'));
 assert.ok(get('/v1/lab/learning-source-track'));
 assert.equal(get('/v1/lab/user-marks'),null);
 assert.equal(get('/v1/lab/learning-source-track','POST'),null);
});

test('a repeated dashboard read can use a short edge cache without D1',async()=>{
 const values=new Map(),cache={async match(key){return values.get(key.url)?.clone()||null},async put(key,value){values.set(key.url,value.clone())}};
 const key=statusCacheKey(new Request('https://api.test/v1/lab/pipeline-status'));
 assert.equal(await readStatusCache(cache,key),null);
 const original=Response.json({ok:true,version:'3.49.36'},{headers:{'cache-control':'no-store'}});
 assert.equal(await writeStatusCache(cache,key,original),true);
 const cached=await readStatusCache(cache,key);
 assert.deepEqual(await cached.json(),{ok:true,version:'3.49.36'});
 assert.equal(cached.headers.get('cache-control'),`public, max-age=${STATUS_CACHE_SECONDS}`);
});

test('failed or non-GET responses are never cached',async()=>{
 const values=new Map(),cache={async put(key,value){values.set(key.url,value)}};
 const key=statusCacheKey(new Request('https://api.test/v1/lab/work-progress'));
 assert.equal(await writeStatusCache(cache,key,Response.json({ok:false},{status:503})),false);
 assert.equal(values.size,0);
});
test('deployment identity is current and remains readable without database or cache access',async()=>{
 const {default:worker,VERSION}=await import('../src/index-v3.49.0.js');
 const DB={prepare(){throw Error('deployment check must not touch D1')}};
 const response=await worker.fetch(new Request('https://api.test/v1/lab/deploy-check'),{DB},{}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.version,VERSION);
 assert.equal(body.build,'verified-user-mark-persistence');
 assert.equal(response.headers.get('cache-control'),'no-store');
});
