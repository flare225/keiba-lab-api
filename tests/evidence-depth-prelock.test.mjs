import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{coreFeatureAudit} from '../src/index-v3.8.2.js';

function dbFixture({missingRecent=false}={}){
 const raceKey='2099-10-10:東京:11';
 return{prepare(sql){return{bind(...args){return{
  first:async()=>{
   if(sql.includes('FROM jra_races'))return{race_key:raceKey,runner_count:2};
   if(sql.includes('FROM lab_model_locks'))return{c:0};
   return null;
  },
  all:async()=>{
   if(sql.includes('FROM jra_runners WHERE race_key'))return{results:[{horse_no:1,horse_name:'テストア'},{horse_no:2,horse_name:'テストイ'}]};
   if(sql.includes('FROM lab_prediction_snapshots'))return{results:[{horse_no:1,basic_score:80,recent_score:78,model_coverage_pct:70,confidence_pct:58},{horse_no:2,basic_score:76,recent_score:missingRecent?null:74,model_coverage_pct:70,confidence_pct:50}]};
   if(sql.includes('FROM lab_pace_style_snapshots'))return{results:[{horse_no:1,pace_style_fit_score:75,evidence_confidence:'observed'},{horse_no:2,pace_style_fit_score:72,evidence_confidence:'neutral-imputation-missing-official-corner-source'}]};
   if(sql.includes('FROM lab_integrated_snapshots'))return{results:[{horse_no:1,prefinal_points:66},{horse_no:2,prefinal_points:62}]};
   if(sql.includes('COUNT(p.race_date) AS history_rows'))return{results:[{horse_no:1,history_rows:2},{horse_no:2,history_rows:1}]};
   return{results:[]};
  }
 };}}}};
}

test('core audit is ready with full required feature coverage while retaining thin-history warning',async()=>{
 const a=await coreFeatureAudit(dbFixture(),'2099-10-10','東京',11,'良');
 assert.equal(a.ready,true);assert.equal(a.coverage.basicAbility.pct,100);assert.equal(a.coverage.recentPerformance.pct,100);assert.equal(a.history.oneHistoryCount,1);assert.ok(a.warnings.includes('some-runners-have-only-one-pre-race-history-row'));
});

test('missing required recent-performance evidence blocks a new prospective seal',async()=>{
 const db=dbFixture({missingRecent:true});
 const a=await coreFeatureAudit(db,'2099-10-10','東京',11,'良');assert.equal(a.ready,false);assert.equal(a.coverage.recentPerformance.pct,50);
 const r=await worker.fetch(new Request('https://test/v1/lab/prospective-seal?date=2099-10-10&venue=東京&race_no=11&track=良'),{DB:db},{});
 const d=await r.json();assert.equal(r.status,409);assert.match(d.error,/core pre-race feature coverage is incomplete/);
});

test('v3.8.2 deployment check exposes evidence-depth build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});const d=await r.json();assert.equal(d.version,'3.8.2');assert.equal(d.build,'prelock-core-coverage-and-evidence-depth');
});
