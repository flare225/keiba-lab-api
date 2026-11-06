import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {wakeAutomaticPredictionForHistory} from '../src/history-collection-v3.37.0.js';
const now=Date.parse('2026-11-06T15:24:00+09:00');
const race={race_key:'2026-11-07:福島:3',race_date:'2026-11-07',venue:'福島',race_no:3};
test('new rows wake only the exact future formal missing-history receipt and preserve its evidence',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE lab_automatic_prediction_receipts_v1(race_key TEXT PRIMARY KEY,status TEXT,next_attempt_at INTEGER,detail_json TEXT)');
 const other=['saved','deferred','reconciled','awaiting-data'];
 for(const [key,status] of [[race.race_key,'awaiting-prior-history'],['other','awaiting-prior-history'],...other.map(s=>[s,s])])sql.prepare('INSERT INTO lab_automatic_prediction_receipts_v1 VALUES(?,?,?,?)').run(key,status,now+3600000,'{"evidence":"unchanged"}');
 const db={prepare(q){assert.match(q,/^UPDATE/);return{bind(...a){return{async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}}}}}}}};
 const before=sql.prepare('SELECT * FROM lab_automatic_prediction_receipts_v1 ORDER BY race_key').all();
 assert.equal(await wakeAutomaticPredictionForHistory(db,race,0,now),0);
 assert.deepEqual(sql.prepare('SELECT * FROM lab_automatic_prediction_receipts_v1 ORDER BY race_key').all(),before);
 assert.equal(await wakeAutomaticPredictionForHistory(db,race,3,now),1);
 const after=sql.prepare('SELECT * FROM lab_automatic_prediction_receipts_v1 ORDER BY race_key').all().map(r=>({...r}));
 assert.deepEqual(after,before.map(r=>({...r,...(r.race_key===race.race_key?{next_attempt_at:now}:{})})));
 assert.equal(await wakeAutomaticPredictionForHistory(db,race,3,now),0);
 // Protected receipts do not wake even when their identity is selected.
 for(const status of other){sql.prepare('UPDATE lab_automatic_prediction_receipts_v1 SET status=?,next_attempt_at=? WHERE race_key=?').run(status,now+3600000,race.race_key);assert.equal(await wakeAutomaticPredictionForHistory(db,race,3,now),0);}
 sql.close();
});
test('absent tables are compatible, but quota/errors propagate; zero rows, expected rosters and past races issue no SQL',async()=>{
 const noSql={prepare(){assert.fail('ineligible inputs must not write')}};
 for(const [r,n] of [[race,0],[race,-1],[{...race,race_key:'expected:test'},3],[{...race,race_date:'2026-11-01',race_key:'2026-11-01:福島:3'},3]])assert.equal(await wakeAutomaticPredictionForHistory(noSql,r,n,now),0);
 const fail=error=>({prepare(){return{bind(){return{async run(){throw Error(error)}}}}}});
 assert.equal(await wakeAutomaticPredictionForHistory(fail('no such table: lab_automatic_prediction_receipts_v1'),race,1,now),0);
 await assert.rejects(wakeAutomaticPredictionForHistory(fail('exceeded D1 daily row read limit'),race,1,now),/daily row read limit/);
 await assert.rejects(wakeAutomaticPredictionForHistory(fail('database is locked'),race,1,now),/database is locked/);
});
