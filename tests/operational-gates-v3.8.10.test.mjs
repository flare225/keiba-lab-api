import test from 'node:test';
import assert from 'node:assert/strict';
import app,{VERSION} from '../src/index-v3.8.10.js';

function emptyDb(){
 return{prepare(sql){return{bind(){return{async first(){
  if(sql.includes('FROM jra_races'))return null;
  if(sql.includes('FROM jra_runners'))return{n:0,distinct_n:0,first_no:null,last_no:null};
  return null;
 }}}}}};
}

test('v3.8.10 exposes explicit Saudi RC operational gate state',async()=>{
 assert.equal(VERSION,'3.8.10');
 const r=await app.fetch(new Request('https://lab.test/v1/lab/saudi-rc-operational-status'),{DB:emptyDb()},{});
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.raceKey,'2026-10-10:東京:11');
 assert.equal(j.gates.officialCardStored,false);
 assert.equal(j.gates.explicitTrackProvided,false);
 assert.equal(j.gates.readyToSeal,false);
 assert.equal(j.nextGate,'precard-runner-info');
 assert.equal(j.guardrails.explicitTrackRequiredBeforeSeal,true);
});

test('capabilities declare atomic mark persistence requirement',async()=>{
 const r=await app.fetch(new Request('https://lab.test/v1/lab/user-mark-capabilities'),{},{});
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.version,'3.8.10');
 assert.equal(j.principles.storageAtomicRequired,true);
 assert.equal(j.principles.scoreMutation,false);
});

test('authorized confirmed mark save fails closed without D1 batch',async()=>{
 const body={confirm:'SAVE',date:'2026-10-10',venue:'東京',raceNo:11,phase:'initial',marks:[{horseName:'TEST',mark:'◎'}]};
 const r=await app.fetch(new Request('https://lab.test/v1/lab/user-marks',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer secret'},body:JSON.stringify(body)}),{DB:emptyDb(),USER_MARK_WRITE_TOKEN:'secret'},{});
 assert.equal(r.status,503);
 const j=await r.json();
 assert.equal(j.storageAtomicRequired,true);
 assert.match(j.error,/atomic D1 batch/);
});
