import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import app from '../src/index-v3.49.0.js';import {readPrecardRaceState,PRECARD_STATE_PATHS} from '../src/precard-race-state.js';
import {EXPECTED_ROSTER_SEEDS} from '../src/expected-roster-seeds.js';import {saveExpectedRoster} from '../src/expected-roster-registry.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE jra_races(race_key TEXT,race_date TEXT,venue TEXT,race_no INTEGER);CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER)');const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async first(){return sql.prepare(q).get(...a)||null},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}});return w()}};return{sql,db}}
test('all saved expected rosters return waiting state across every race panel without claiming official readiness',async()=>{
 const {db,sql}=fixture();for(const s of EXPECTED_ROSTER_SEEDS)await saveExpectedRoster(db,s.record,Date.parse('2026-10-20T05:00:00Z'));
 for(const seed of EXPECTED_ROSTER_SEEDS){const t=seed.record;for(const path of PRECARD_STATE_PATHS){const q=new URLSearchParams({date:t.date,venue:t.venue,race_no:String(t.raceNo)}),r=await app.fetch(new Request('https://api.test'+path+'?'+q),{DB:db},{}),d=await r.json();assert.equal(r.status,200);assert.equal(d.precard.runnerCount,t.runners.length);assert.equal(d.readiness.cardComplete,false);assert.equal(d.audit.passed,false);assert.equal(d.ops.preRaceReady,false);assert.equal(d.prediction.locked,false);assert.match(d.message,/想定名簿/);assert.ok(!JSON.stringify(d).includes('race not found'));}}
 sql.close();
});
test('program-only races are pending, unknown identities remain missing and stored official cards keep their existing audit route',async()=>{
 const {db,sql}=fixture();sql.exec("INSERT INTO jra_race_program VALUES('2026-10-24','新潟',1)");const t={date:'2026-10-24',venue:'新潟',raceNo:1};const p=await readPrecardRaceState(db,t);assert.equal(p.status,200);assert.equal(p.data.precard.available,false);assert.equal((await readPrecardRaceState(db,{...t,raceNo:2})).status,404);sql.exec("INSERT INTO jra_races VALUES('card','2026-10-24','新潟',1)");assert.equal(await readPrecardRaceState(db,t),null);sql.close();
});
test('DB failure cannot become a successful pending state',async()=>{await assert.rejects(readPrecardRaceState({prepare(){throw Error('DB unavailable')}},{date:'2026-10-24',venue:'新潟',raceNo:11}),/DB unavailable/);});
test('six concurrent race panels share one state read; later reads remain fresh',async context=>{
 const {db,sql}=fixture();sql.exec("INSERT INTO jra_race_program VALUES('2026-10-24','新潟',1)");
 let reads=0;const counted={prepare(q){reads++;return db.prepare(q);}},t={date:'2026-10-24',venue:'新潟',raceNo:1};
 const single=await readPrecardRaceState(counted,t),baseline=reads;reads=0;for(let i=0;i<6;i++)await readPrecardRaceState(counted,t);const separateCalls=reads;assert.equal(separateCalls,baseline*6);reads=0;
 const responses=await Promise.all([...PRECARD_STATE_PATHS].map(path=>app.fetch(new Request('https://api.test'+path+'?'+new URLSearchParams({date:t.date,venue:t.venue,race_no:'1'})),{DB:counted},{})));
 const bodies=await Promise.all(responses.map(r=>r.json()));assert.equal(bodies.length,6);assert.equal(reads,baseline);context.diagnostic(JSON.stringify({panels:6,separateCalls,sharedCalls:reads,unit:'prepare calls in SQLite fixture; not production D1 rows'}));assert.ok(baseline>0);assert.ok(bodies.every(x=>x.status==='awaiting-official-card'&&x.prediction.locked===false));
 // Separate copies: no panel can accidentally change another panel's state.
 const [a,b]=await Promise.all([readPrecardRaceState(counted,t),readPrecardRaceState(counted,t)]);a.data.audit.passed=true;assert.equal(b.data.audit.passed,false);
 sql.exec("INSERT INTO jra_races VALUES('new-card','2026-10-24','新潟',1)");assert.equal(await readPrecardRaceState(counted,t),null);assert.equal(single.data.precard.available,false);sql.close();
});
test('sharing never crosses race or DB identity, and failures are not retained',async()=>{
 const {db,sql}=fixture();sql.exec("INSERT INTO jra_race_program VALUES('2026-10-24','新潟',1)");const t={date:'2026-10-24',venue:'新潟',raceNo:1};
 const states=await Promise.all([readPrecardRaceState(db,t),readPrecardRaceState(db,{...t,raceNo:2})]);assert.deepEqual(states.map(x=>x.status),[200,404]);
 let failed=true,calls=0;const changing={prepare(q){calls++;if(failed)throw Error('D1 daily read limit');return db.prepare(q);}};
 const rejected=await Promise.allSettled([readPrecardRaceState(changing,t),readPrecardRaceState(changing,t)]);assert.ok(rejected.every(x=>x.status==='rejected'));assert.equal(calls,1);
 failed=false;assert.equal((await readPrecardRaceState(changing,t)).status,200);const other=fixture();assert.equal((await readPrecardRaceState(other.db,t)).status,404);other.sql.close();sql.close();
});
