import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {missingPriorHistorySql} from '../src/learning-history-priority.js';
import {scheduledWeekendHistory} from '../src/expected-history-collection-v3.46.0.js';
test('fresh stored history outranks stale missing counts; target-day and wrong cohort never improve priority',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE jra_races(race_key TEXT,race_date TEXT);CREATE TABLE jra_runners(race_key TEXT,horse_name TEXT,age INTEGER);CREATE TABLE jra_past_performances(horse_name TEXT,race_date TEXT,finish_position INTEGER,field_size INTEGER);INSERT INTO jra_races VALUES('complete','2026-10-04'),('partial','2026-10-04'),('empty','2026-10-04');INSERT INTO jra_runners VALUES('complete','A',2),('partial','A',2),('partial','B',2),('empty','C',2);INSERT INTO jra_past_performances VALUES('A','2026-09-01',1,12),('B','2026-10-04',1,12),('B','2025-09-01',1,12),('C','2026-09-01',NULL,12);");
 const ranks=db.prepare('SELECT r.race_key,'+missingPriorHistorySql('r.race_key','r.race_date')+' missing FROM jra_races r ORDER BY missing,r.race_key').all();
 assert.deepEqual(ranks.map(r=>[r.race_key,r.missing]),[['complete',0],['empty',1],['partial',1]]);db.close();
});
test('reserved training slot invokes past-only collector and stops on progress or shared cooldown',async()=>{
 for(const result of [{attempted:1,externalRequests:1,status:'completed'},{attempted:0,externalRequests:0,status:'cooldown'}]){
  let calls=0;const r=await scheduledWeekendHistory({}, {now:()=>540000,trainingCollector:async(db,opts)=>{calls++;assert.equal(opts.trainingOnly,true);return result;}});
  assert.equal(calls,1);assert.equal(r.historyLane,'training');assert.equal(r.status,result.status);
 }
});
