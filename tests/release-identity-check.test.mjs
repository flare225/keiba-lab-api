import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {expectedRelease,verifyPublishedRelease} from '../scripts/verify-published-release.mjs';
import {VERSION} from '../src/index-v3.49.0.js';

test('release verification uses one database-free request and does not claim persistence',async()=>{
 let calls=0;
 const result=await verifyPublishedRelease(VERSION,{fetcher:async(url,options)=>{
  calls++;assert.equal(new URL(url).pathname,'/v1/lab/deploy-check');
  assert.equal(options.redirect,'error');
  return Response.json({ok:true,version:VERSION});
 }});
 assert.equal(calls,1);assert.equal(result.databaseVerified,false);
 assert.equal(await expectedRelease(),VERSION);
});

test('403, 429, 503 and stale versions stop on the first response without leaking its body',async()=>{
 for(const status of [403,429,503,400]){
  let calls=0;
  await assert.rejects(()=>verifyPublishedRelease(VERSION,{fetcher:async()=>{
   calls++;return new Response('private upstream content',{status});
  }}),error=>error.message.includes('HTTP '+status)&&!error.message.includes('private'));
  assert.equal(calls,1);
 }
 await assert.rejects(()=>verifyPublishedRelease(VERSION,{fetcher:async()=>Response.json({ok:true,version:'old'})}),/does not match/);
});

test('historical DB audits are explicit manual workflows, not repeated on every source push',async()=>{
 for(const name of ['production-smoke','workout-schema-production','historical-result-audit']){
  const source=await readFile(new URL('../.github/workflows/'+name+'.yml',import.meta.url),'utf8');
  assert(source.includes('workflow_dispatch:'));
  assert(!/^  push:/m.test(source));
 }
 const workflow=await readFile(new URL('../.github/workflows/publish-worker.yml',import.meta.url),'utf8');
 assert(workflow.indexOf('Test exact release source')<workflow.indexOf('Publish tested Worker'));
 assert(workflow.includes('node scripts/verify-published-release.mjs'));
 assert(!workflow.includes('/v1/lab/workouts'));
});
