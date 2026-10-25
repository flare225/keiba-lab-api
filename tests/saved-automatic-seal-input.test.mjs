import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSavedAutomaticSealInput} from '../src/saved-automatic-seal-input.js';
import {scheduledAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {runSharedPageStep} from '../src/shared-page-acquisition.js';
import {sha256} from '../src/card-evidence.js';
import {fixtureDatabase,racesFixture,pageGraph,fixtureFetcher,cardUrl,calendar} from './helpers/shared-page-fixture.mjs';
// Upcoming dates/times are official program facts; all horses/pages are synthetic.
async function fixture(date){
 const f=await fixtureDatabase(),now=Date.parse('2026-10-26T00:00:00Z'),time=date==='2026-10-31'?'09:50':'10:00',r={...racesFixture()[0],date,startAt:date+'T'+time+':00+09:00',rootUrl:calendar(date),enqueuedAt:new Date(now).toISOString()};r.cardUrl=cardUrl(r);
 assert.equal((await runSharedPageStep(f.db,{scope:date,races:[r]},{now:()=>now,fetcher:fixtureFetcher(pageGraph([r]))})).formalCardSaved,true);
 await ensureHistoryTable(f.db);f.sql.exec('CREATE TABLE jra_race_program(race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT)');
 f.sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?)').run(date,r.venue,r.raceNo,time,r.rootUrl);
 for(const name of ['テストア','テストイ'])for(const d of ['2026-09-01','2026-09-15','2026-10-01'])f.sql.prepare('INSERT INTO jra_past_performances(horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,source_url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(name,d,r.venue,'合成履歴','芝',1600,2,12,'https://www.jra.go.jp/profile',new Date(now).toISOString());
 const saved=await scheduledAutomaticPrediction(f.db,now+61000);assert.equal(saved.saved,1);f.reset();return{...f,r,now:now+120000,saved};
}
test('existing saved forecast becomes a seal input without rescoring, writes or a LOCK claim on both upcoming dates',async()=>{
 for(const date of ['2026-10-31','2026-11-01']){const {db,sql,stats,r,now,saved}=await fixture(date),before=sql.prepare('SELECT * FROM lab_automatic_predictions_v1').get();const out=await prepareSavedAutomaticSealInput(db,r,now);assert.equal(out.eligible,true);assert.equal(out.sealed,false);assert.equal(out.requiresAtomicRecheck,true);assert.equal(out.predictionSha256,saved.snapshotSha256);assert.equal(await sha256(out.snapshotJson),saved.snapshotSha256);assert.deepEqual(JSON.parse(out.snapshotJson).runners,saved.snapshot.runners);assert.ok(stats.executed.every(q=>q.startsWith('SELECT')));assert.deepEqual(sql.prepare('SELECT * FROM lab_automatic_predictions_v1').get(),before);sql.close();}
});
test('deadline, changed card and saved results block eligibility without creating or modifying a seal',async()=>{
 for(const change of ['deadline','card','result']){const {db,sql,r,now}=await fixture('2026-10-31');if(change==='card')sql.exec('UPDATE jra_runners SET frame_no=8 WHERE horse_no=1');if(change==='result')sql.prepare('INSERT INTO lab_race_outcomes VALUES(?,?,1)').run('2026-10-31:東京:1',1);if(change==='deadline')assert.equal((await prepareSavedAutomaticSealInput(db,r,Date.parse(r.startAt)-300000)).eligible,false);else await assert.rejects(prepareSavedAutomaticSealInput(db,r,now));assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('lab_model_locks','lab_prospective_seals')").get().n,0);sql.close();}
});
