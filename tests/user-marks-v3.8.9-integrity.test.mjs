import test from 'node:test';
import assert from 'node:assert/strict';
import app,{VERSION} from '../src/index-v3.8.9.js';

test('v3.8.9 advertises finalized immutable mark revisions',async()=>{
 assert.equal(VERSION,'3.8.9');
 const r=await app.fetch(new Request('https://lab.test/v1/lab/user-mark-capabilities'),{},{});
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.version,'3.8.9');
 assert.equal(j.principles.revisionImmutableAfterInsert,true);
 assert.equal(j.principles.auditFinalizedBeforeInsert,true);
 assert.equal(j.principles.scoreMutation,false);
});

test('mark persistence fails closed when write secret is absent',async()=>{
 const r=await app.fetch(new Request('https://lab.test/v1/lab/user-marks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:'SAVE',date:'2026-10-10',venue:'東京',raceNo:11,phase:'initial',marks:[{horseName:'TEST',mark:'◎'}]})}),{DB:{}},{});
 assert.equal(r.status,503);
 const j=await r.json();
 assert.equal(j.writeReady,false);
});

test('mark persistence requires explicit SAVE confirmation before auth',async()=>{
 const r=await app.fetch(new Request('https://lab.test/v1/lab/user-marks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-10-10',venue:'東京',raceNo:11,phase:'initial',marks:[{horseName:'TEST',mark:'◎'}]})}),{DB:{},USER_MARK_WRITE_TOKEN:'secret'},{});
 assert.equal(r.status,409);
 const j=await r.json();
 assert.match(j.error,/confirm=SAVE/);
});

test('source installs no-update and no-delete guards for revisions and entries',async()=>{
 const fs=await import('node:fs/promises');
 const src=await fs.readFile(new URL('../src/index-v3.8.9.js',import.meta.url),'utf8');
 for(const needle of ['trg_user_mark_revision_no_update','trg_user_mark_revision_no_delete','trg_user_mark_entry_no_update','trg_user_mark_entry_no_delete'])assert.match(src,new RegExp(needle));
 assert.match(src,/auditFinalizedBeforeInsert:true/);
});
