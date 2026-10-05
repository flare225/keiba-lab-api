import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inspectSourceCard,requireLockEvidence,sha256,runnerFingerprint} from '../src/card-evidence.js';
import {writeAtomicSeal,verifyStoredSeal,ensureSealGuards} from '../src/prospective-seal-store.js';
function adapter(sqlite){return{prepare(sql){return{bind(...args){return{sql,args,run:async()=>sqlite.prepare(sql).run(...args),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)})}},run:async()=>sqlite.prepare(sql).run()};},async batch(statements){sqlite.exec('BEGIN');try{const r=statements.map(x=>sqlite.prepare(x.sql).run(...x.args));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(`CREATE TABLE lab_model_locks(race_key TEXT,model_version TEXT,track_condition TEXT,seal_kind TEXT,weights_json TEXT,snapshot_json TEXT,sealed_at TEXT,UNIQUE(race_key,model_version,track_condition));CREATE TABLE lab_prospective_seals(race_key TEXT,race_date TEXT,model_version TEXT,track_condition TEXT,seal_kind TEXT,snapshot_sha256 TEXT,runner_count INTEGER,outcome_count_at_seal INTEGER,future_day_lock INTEGER,quality_json TEXT,sealed_at TEXT,UNIQUE(race_key,model_version,track_condition));CREATE TABLE lab_race_outcomes(race_key TEXT,finish_position INTEGER);CREATE TABLE jra_races(race_key TEXT,fetched_at TEXT);`);return{sqlite,db:adapter(sqlite)};}
const record={raceKey:'2026-10-10:東京:11',date:'2026-10-10',modelVersion:'3.3.0-prospective',track:'良',sealKind:'prospective-holdout',weights:{},snapshotJson:'{}',hash:'hash',runnerCount:2,futureDayLock:true,quality:{},sealedAt:'now'};
function horse(no,frame=String(no)){return `<tr><td>${frame}</td><td>${no}</td><td><a>テスト${no===1?'ア':'イ'}</a>父：テスト 母：テスト</td><td>牡2 55kg <a>山田</a></td></tr>`;}
test('strict parser counts source horse rows and observes supplied horse/frame numbers',()=>{const r=inspectSourceCard(`<p>出走頭数：2頭</p><table>${horse(1)}${horse(2)}</table>`);assert.equal(r.declaredCount,2);assert.equal(r.sourceRowCount,2);assert.ok(r.allHorseNumbersObserved);assert.ok(r.allFramesObserved);assert.equal(r.frames.get(2),2);});
test('strict parser rejects missing horse numbers before legacy normalization',()=>{const r=inspectSourceCard(`<p>2頭</p><table>${horse(1,'')}${horse(2,'').replace('<td>2</td>','<td></td>')}</table>`);assert.equal(r.allHorseNumbersObserved,false);assert.equal(r.allFramesObserved,false);});
test('source rows rejected by legacy parser remain visible as missing',()=>{const r=inspectSourceCard(`<p>2頭</p><table>${horse(1)}${horse(2).replace('55kg','不明')}</table>`);assert.equal(r.sourceRowCount,2);assert.equal(r.raw.length,1);assert.equal(r.allHorseNumbersObserved,false);});
test('conflicting declared counts are unverified',()=>{assert.equal(inspectSourceCard(`<p>2頭 3頭</p>${horse(1)}${horse(2)}`).declaredCount,null);});
test('two seal rows commit together and duplicate execution does not change them',async()=>{const{sqlite,db}=database();await writeAtomicSeal(db,record);await assert.rejects(writeAtomicSeal(db,{...record,hash:'different'}));assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lab_model_locks').get().n,1);assert.equal(sqlite.prepare('SELECT snapshot_sha256 FROM lab_prospective_seals').get().snapshot_sha256,'hash');});
test('failure in second seal insert rolls back first insert',async()=>{const{sqlite,db}=database();sqlite.prepare('INSERT INTO lab_prospective_seals(race_key,model_version,track_condition) VALUES(?,?,?)').run(record.raceKey,record.modelVersion,record.track);await assert.rejects(writeAtomicSeal(db,record));assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lab_model_locks').get().n,0);});
test('database refuses sealing when official outcomes appear',async()=>{const{sqlite,db}=database();await ensureSealGuards(db);sqlite.prepare('INSERT INTO lab_race_outcomes VALUES(?,1)').run(record.raceKey);await assert.rejects(writeAtomicSeal(db,record));assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lab_model_locks').get().n,0);});
test('database refuses mutation or deletion of prospective locks',async()=>{const{sqlite,db}=database();await ensureSealGuards(db);await writeAtomicSeal(db,record);for(const sql of ["UPDATE lab_model_locks SET snapshot_json='changed'","DELETE FROM lab_model_locks","UPDATE lab_prospective_seals SET snapshot_sha256='changed'","DELETE FROM lab_prospective_seals"])assert.throws(()=>sqlite.exec(sql));});
test('stored seals require matching SHA-256',async()=>{const snapshot_json='{"runners":[]}';assert.deepEqual(await verifyStoredSeal({snapshot_json,snapshot_sha256:await sha256(snapshot_json)}),{runners:[]});await assert.rejects(verifyStoredSeal({snapshot_json,snapshot_sha256:'wrong'}));await assert.rejects(verifyStoredSeal({snapshot_json}));});
test('LOCK fails closed when official card evidence is absent',async()=>{const{db}=database();await assert.rejects(requireLockEvidence(db,{race_key:record.raceKey},[]),/requires current official/);});
test('runner fingerprint includes source frame, name and horse number',()=>{assert.notEqual(runnerFingerprint([{horseNo:1,frameNo:1,name:'ア'}]),runnerFingerprint([{horseNo:1,frameNo:2,name:'ア'}]));});
test('card evidence changed after prediction is refused inside seal transaction',async()=>{
 const {ensureCardSealGuard}=await import('../src/prospective-seal-store.js');
 const{sqlite,db}=database();sqlite.exec('CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,frame_no INTEGER)');
 await assert.rejects(requireLockEvidence(db,{race_key:record.raceKey},[]));
 await ensureCardSealGuard(db);
 await assert.rejects(writeAtomicSeal(db,{...record,snapshotJson:JSON.stringify({cardEvidence:{source_sha256:'old',runner_sha256:'old'},race:{runnerCount:2},runners:[]})}));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lab_model_locks').get().n,0);
});
test('transaction card guard accepts a verified exact card and blocks a subsequent change',async()=>{
 const{ensureCardSealGuard}=await import('../src/prospective-seal-store.js');const{sqlite,db}=database();
 sqlite.exec('CREATE TABLE jra_runners(race_key TEXT,horse_no INTEGER,horse_name TEXT,frame_no INTEGER)');
 await assert.rejects(requireLockEvidence(db,{race_key:record.raceKey},[]));
 sqlite.prepare('INSERT INTO jra_races VALUES(?,?)').run(record.raceKey,'now');
 sqlite.prepare('INSERT INTO jra_runners VALUES(?,1,?,1)').run(record.raceKey,'ア');
 sqlite.prepare('INSERT INTO lab_card_source_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(record.raceKey,'url','source','runners',1,1,1,1,1,'now','now','explicit-label');
 await ensureCardSealGuard(db);
 const snapshotJson=JSON.stringify({cardEvidence:{source_sha256:'source',runner_sha256:'runners'},race:{runnerCount:1},runners:[{horseNo:1,horseName:'ア',frameNo:1}]});
 await writeAtomicSeal(db,{...record,snapshotJson,runnerCount:1});
 sqlite.exec('DELETE FROM lab_model_locks;DELETE FROM lab_prospective_seals;UPDATE jra_runners SET horse_name=\'イ\'');
 await assert.rejects(writeAtomicSeal(db,{...record,snapshotJson,runnerCount:1}));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM lab_model_locks').get().n,0);
});
test('official roster cells provide independent count without counting unrelated horse tables',()=>{
 const row=(no,color)=>horse(no,'').replace('<td></td>',`<td class="waku"><img alt="枠${no}${color}" /></td>`).replace('<td><a>','<td class="horse"><a>');
 const html=`<table>${row(1,'白')}${row(2,'黒')}</table><table><tr><td class="horse">関連馬</td></tr></table>`;
 const e=inspectSourceCard(html);assert.equal(e.declaredCount,2);assert.equal(e.countBasis,'official-roster-cells');assert.ok(e.allFramesObserved);
});
