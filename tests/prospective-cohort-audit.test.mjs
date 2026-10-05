import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{summarizeRunnerCohort,summarizeRaceSet} from '../src/index-v3.8.3.js';

test('runner cohort separates rank error and top3 capture cleanly',()=>{
 const rows=[
  {predictedRank:1,actualFinish:1,historyRows:1,baseEvidenceConfidencePct:45},
  {predictedRank:2,actualFinish:4,historyRows:1,baseEvidenceConfidencePct:48},
  {predictedRank:4,actualFinish:2,historyRows:1,baseEvidenceConfidencePct:49},
 ];
 const m=summarizeRunnerCohort(rows);
 assert.equal(m.runnerSamples,3);
 assert.equal(m.meanAbsoluteRankError,1.3);
 assert.equal(m.exactRankPct,33.3);
 assert.equal(m.within2RanksPct,100);
 assert.equal(m.predictedTop3PrecisionPct,50);
 assert.equal(m.actualTop3RecallPct,50);
 assert.equal(m.averageHistoryRows,1);
 assert.equal(m.averageBaseEvidenceConfidencePct,47.3);
 assert.equal(m.sampleStatus,'too-small');
});

test('race-set summary reports winner and top3 performance without mutating model state',()=>{
 const races=[
  {metrics:{winnerHit:true,winnerInTop3:true,top3RecallPct:66.7,meanAbsoluteRankError:1.5}},
  {metrics:{winnerHit:false,winnerInTop3:true,top3RecallPct:100,meanAbsoluteRankError:2.5}},
 ];
 const m=summarizeRaceSet(races);
 assert.equal(m.raceSamples,2);
 assert.equal(m.winnerHitPct,50);
 assert.equal(m.winnerInTop3Pct,100);
 assert.equal(m.averageTop3RecallPct,83.4);
 assert.equal(m.averageMeanAbsoluteRankError,2);
 assert.equal(m.sampleStatus,'too-small');
});

test('empty cohort is explicit no-data rather than fake zero accuracy',()=>{
 const m=summarizeRunnerCohort([]);
 assert.equal(m.runnerSamples,0);
 assert.equal(m.sampleStatus,'no-data');
 assert.equal(m.meanAbsoluteRankError,null);
 assert.equal(m.averageBaseEvidenceConfidencePct,null);
});

test('v3.8.3 deployment check exposes strict cohort audit build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});
 const d=await r.json();
 assert.equal(r.status,200);
 assert.equal(d.version,'3.8.3');
 assert.equal(d.build,'strict-prospective-cohort-audit');
});

test('cohort endpoint fails closed without D1',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/prospective-cohort-audit?scope=two-year-old'),{},{});
 const d=await r.json();
 assert.equal(r.status,500);
 assert.match(d.error,/D1 binding/);
});

test('required validation storage errors are not converted into fake empty success',async()=>{
 const DB={prepare(){throw new Error('required validation table unavailable')}};
 const r=await worker.fetch(new Request('https://test/v1/lab/prospective-cohort-audit?scope=two-year-old'),{DB},{});
 const d=await r.json();
 assert.equal(r.status,500);
 assert.equal(d.ok,false);
 assert.match(d.error,/required validation table unavailable/);
});
