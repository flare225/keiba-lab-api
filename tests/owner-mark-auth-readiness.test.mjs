import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_URL,WORKER_URL,evaluateMarkAuthReadiness,readJson,checkLive,summaryLines}
 from '../scripts/check-owner-mark-auth-readiness.mjs';

test('readiness requires BOTH Vercel auth setup and Cloudflare Worker write token',()=>{
 const ready=evaluateMarkAuthReadiness({ok:true,configured:true,authenticated:false},{ok:true,writeReady:true});
 assert.equal(ready.ready,true);
 assert.equal(ready.actualWriteVerified,false);
 for(const [app,worker] of [
  [{ok:true,configured:false,authenticated:false},{ok:true,writeReady:true}],
  [{ok:true,configured:true,authenticated:false},{ok:true,writeReady:false}],
  [null,{ok:true,writeReady:true}],
  [{ok:true,configured:true,authenticated:false},null],
  [{ok:false,configured:true,authenticated:false},{ok:true,writeReady:true}]
 ]){
  const d=evaluateMarkAuthReadiness(app,worker);
  assert.equal(d.ready,false);
  assert.ok(d.errors.length>=1);
 }
});

test('live checks only known HTTPS URLs using unauthenticated GET and no DB queries',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  return new Response(JSON.stringify(url===APP_URL?
   {ok:true,configured:true,authenticated:false}:{ok:true,writeReady:true}),
   {headers:{'content-type':'application/json'}});
 };
 const result=await checkLive(fetcher);
 assert.equal(result.ready,true);
 assert.deepEqual(calls.map(x=>x.url),[APP_URL,WORKER_URL]);
 assert.ok(calls.every(x=>x.opts.method==='GET'&&x.opts.redirect==='error'&&!x.opts.body&&!x.opts.headers.authorization));
 assert.doesNotMatch(JSON.stringify(calls),/user-marks\?|race-ops|storage-audit/);
});
test('fail closed when an endpoint errors or is a misleading HTTP 200 HTML page',async()=>{
 const html=await checkLive(async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}));
 assert.equal(html.ready,false);
 const partial=await checkLive(async url=>url===APP_URL?
  new Response(JSON.stringify({ok:true,configured:true,authenticated:false}),{headers:{'content-type':'application/json'}}):
  new Response(JSON.stringify({ok:false,error:'blocked'}),{status:503,headers:{'content-type':'application/json'}}));
 assert.equal(partial.ready,false);
 assert.ok(partial.errors.some(x=>/Worker/.test(x)));
});
test('CI summary never prints secret values nor claims real DB writes were proven',()=>{
 const summary=summaryLines(evaluateMarkAuthReadiness({ok:true,configured:true,authenticated:false},{ok:true,writeReady:true})).join('\n');
 assert.match(summary,/configuration READY/i);
 assert.match(summary,/NOT RUN/);
 assert.doesNotMatch(summary,/DB write.*verified|password:/i);
});


test('summarizes individual missing Vercel settings without returning lengths or values',()=>{
 const result=evaluateMarkAuthReadiness({
  ok:true,configured:false,authenticated:false,
  configuration:{ownerPassphraseReady:true,sessionSecretReady:false,writeTokenReady:true}
 },{ok:true,writeReady:true});
 assert.equal(result.ready,false);
 assert.deepEqual(result.appConfiguration,{
  ownerPassphraseReady:true,sessionSecretReady:false,writeTokenReady:true
 });
 assert.match(result.errors.join(' '),/session secret missing or below minimum length/i);
 const summary=summaryLines(result).join('\\n');
 assert.match(summary,/Vercel session secret.*BLOCKED/);
 assert.doesNotMatch(summary,/32 characters|password:|secret-value/i);
 assert.doesNotMatch(summary,/configuration READY/i);
});
