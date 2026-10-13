import test from 'node:test';
import assert from 'node:assert/strict';
import {attachSavedReferenceAssessment} from '../src/saved-reference-assessment-v3.50.0.js';

const alignment=(mark,rank)=>({mark,rank});
const audit=(laboRank=null,laboScore=null)=>({ok:true,identityBasis:'official-numbered-card',audit:{marked:[{horseNo:2,horseName:'馬A',mark:'◎',laboRank,laboScore,alignment:{old:true}}],guardrails:{userMarksNeverChangeLABORank:true}}});
const reference=(rows,scored=rows.length)=>({assessment:{modelVersion:'history-v1',trackAssumption:'良',trackBasis:'user-scenario-not-confirmed-race-day-track',runnerPool:rows.length,scoredRunners:scored,guardrails:{noForcedTieBreak:true},allRunners:rows}});
const row=(horseNo,horseName,rank,score)=>({horseNo,horseName,referenceRank:rank,tiedCount:1,assessment:{available:rank!==null,evidenceScore:score,validFinishRows:4,modelCoveragePct:80,components:{basicAbilityResults:score}}});

test('fills missing stored LABO rank from result-blind all-runner reference assessment',()=>{
 const result=attachSavedReferenceAssessment(audit(),reference([row(2,'馬A',2,73.4),row(4,'馬B',1,81.2)]),alignment);
 const marked=result.audit.marked[0];
 assert.equal(marked.laboRank,2);assert.equal(marked.laboScore,73.4);
 assert.equal(marked.laboRankSource,'history-reference-assessment');
 assert.equal(marked.laboRankBasis,'all-official-runners');
 assert.deepEqual(marked.alignment,{mark:'◎',rank:2});
 assert.equal(result.audit.referenceAssessment.allRunners.length,2);
 assert.equal(result.audit.referenceAssessment.guardrails.targetResultUsed,false);
 assert.equal(result.audit.referenceAssessment.guardrails.retrospectiveAccuracyCreditGranted,false);
});

test('preserves an existing integrated-model rank and score',()=>{
 const result=attachSavedReferenceAssessment(audit(1,88),reference([row(2,'馬A',2,73.4)]),alignment);
 const marked=result.audit.marked[0];
 assert.equal(marked.laboRank,1);assert.equal(marked.laboScore,88);
 assert.equal(marked.laboRankSource,'integrated-model-snapshot');
 assert.equal(marked.referenceRank,2);assert.equal(marked.referenceScore,73.4);
});

test('keeps ties and partial-pool rank basis explicit',()=>{
 const result=attachSavedReferenceAssessment(audit(),reference([row(2,'馬A',1,70),row(4,'馬B',1,70),row(6,'馬C',null,null)],2),alignment);
 const marked=result.audit.marked[0];
 assert.equal(marked.laboRank,1);assert.equal(marked.laboRankBasis,'scored-runners-only');
 assert.equal(result.audit.referenceAssessment.allRunners[1].referenceRank,1);
 assert.equal(result.audit.referenceAssessment.guardrails.noForcedTieBreak,true);
});

test('does not attach reference scores to pre-card or nonofficial audits',()=>{
 const data={...audit(),identityBasis:'precard-non-authoritative'};
 assert.equal(attachSavedReferenceAssessment(data,reference([row(2,'馬A',1,70)]),alignment),data);
});
