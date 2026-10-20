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
