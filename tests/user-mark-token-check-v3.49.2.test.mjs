import test from 'node:test';
import assert from 'node:assert/strict';
import app,{VERSION} from '../src/index-v3.49.0.js';

const token='a-private-token-used-only-in-this-test';
const request=authorization=>new Request('https://lab.test/v1/lab/user-mark-token-check',{
 method:'GET',headers:authorization?{authorization}:undefined
});

test('Worker token parity endpoint is read-only and confirms only an authenticated match',async()=>{
 const db=new Proxy({}, {get(){throw Error('token check must not access D1');}});
 const good=await app.fetch(request('Bearer '+token),{USER_MARK_WRITE_TOKEN:token,DB:db},{});
 assert.equal(good.status,200);
 const match=await good.json();
 assert.equal(match.ok,true);
 assert.equal(match.tokenMatch,true);
 assert.equal(match.mode,'no-write');
 assert.equal(match.version,VERSION);
 assert.equal(JSON.stringify(match).includes(token),false);

 const mismatch=await app.fetch(request('Bearer other-token'),{USER_MARK_WRITE_TOKEN:token,DB:db},{});
 assert.equal(mismatch.status,401);
 const denied=await mismatch.json();
 assert.equal(denied.ok,false);
 assert.equal(denied.tokenMatch,false);
 assert.equal(denied.writeReady,true);

 const missing=await app.fetch(request('Bearer '+token),{DB:db},{});
 assert.equal(missing.status,503);
 const unavailable=await missing.json();
 assert.equal(unavailable.writeReady,false);
 assert.equal(JSON.stringify(unavailable).includes(token),false);
});
