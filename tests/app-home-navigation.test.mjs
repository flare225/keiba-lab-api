import test from 'node:test';import assert from 'node:assert/strict';import app,{addAppHomeNavigation} from '../src/index-v3.48.2.js';
test('standalone data pages provide a fixed application home destination',async()=>{
 for(const path of ['/lab/work-progress','/lab/history-collection','/lab/archive-collection','/lab/learning-experiment','/lab/note-review']){
 const r=await app.fetch(new Request('https://api.example'+path),{},{});assert.equal(r.status,200);const html=await r.text();assert.match(html,/href="https:\/\/keiba-lab-apl.vercel.app\/"/);assert.equal((html.match(/id="labo-app-home"/g)||[]).length,1);assert.ok(html.indexOf('id="labo-app-home"')<html.indexOf('<main'));
 }
});
test('navigation handles implicit body templates and never duplicates itself',()=>{
 const once=addAppHomeNavigation('<html><main>データ</main></html>');assert.equal(addAppHomeNavigation(once),once);assert.match(once,/position:sticky/);
});
