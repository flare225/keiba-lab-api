import test from 'node:test';import assert from 'node:assert/strict';import {runScheduledToCompletion} from '../src/index-v3.48.2.js';
test('scheduled entrypoint stays pending through delegated background work and completion writes',async()=>{
 let release,finished=false,settled=false;const gate=new Promise(r=>release=r),registered=[];
 const task=runScheduledToCompletion({async scheduled(e,env,ctx){ctx.waitUntil((async()=>{await gate;finished=true;})());}},{},{},{waitUntil:p=>registered.push(p)}).then(()=>settled=true);
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.equal(finished,false);assert.equal(registered.length,1);release();await task;assert.equal(finished,true);assert.equal(settled,true);
});
test('scheduled delegated failures reach the trigger outcome',async()=>{
 await assert.rejects(runScheduledToCompletion({async scheduled(e,env,ctx){ctx.waitUntil(Promise.reject(Error('completion failed')));}},{},{},{waitUntil(){}}),/completion failed/);
});
