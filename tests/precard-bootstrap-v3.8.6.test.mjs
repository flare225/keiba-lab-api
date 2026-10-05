import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index-v3.8.6.js';

function fakeDbWithoutHistory(){
  return{
    prepare(sql){
      let args=[];
      const q={
        bind(...v){args=v;return q;},
        async run(){return{meta:{changes:1}};},
        async all(){
          if(sql.includes('jra_past_performances'))throw new Error('no such table: jra_past_performances');
          if(sql.includes('FROM lab_precard_runner_context'))return{results:[]};
          if(sql.includes('FROM jra_runners'))throw new Error('no such table: jra_runners');
          return{results:[]};
        },
        async first(){
          if(sql.includes('FROM lab_precard_targets'))return{
            race_key:'2026-10-10:東京:11',race_date:'2026-10-10',venue:'東京',race_no:11,
            race_name:'サウジアラビアロイヤルカップ',source_url:'https://www.jra.go.jp/keiba/race/092/horse.html',
            not_before:'2026-10-06',enabled:1,last_status:'staged',last_checked_at:null,last_success_at:null
          };
          if(sql.includes('FROM lab_precard_source_evidence'))return null;
          if(sql.includes('FROM jra_races'))throw new Error('no such table: jra_races');
          return null;
        }
      };
      return q;
    }
  };
}

test('v3.8.6 deploy check exposes bootstrap-safe audit build',async()=>{
  const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});
  const d=await r.json();
  assert.equal(r.status,200);
  assert.equal(d.version,'3.8.6');
  assert.equal(d.build,'precard-bootstrap-safe-audit');
});

test('pre-card status remains green when optional history/card tables do not exist yet',async()=>{
  const r=await worker.fetch(new Request('https://test/v1/lab/precard-context-status'),{DB:fakeDbWithoutHistory()},{});
  const d=await r.json();
  assert.equal(r.status,200);
  assert.equal(d.ok,true);
  assert.equal(d.raceKey,'2026-10-10:東京:11');
  assert.equal(d.target.status,'staged');
  assert.equal(d.dataQuality.featuredRunnerCount,0);
  assert.equal(d.officialCardComparison.status,'official-card-not-yet-stored');
  assert.equal(d.bootstrap.missingOptionalTablesAreTreatedAsNoEvidenceNotFatal,true);
  assert.equal(d.guardrails.authoritativeForCard,false);
  assert.equal(d.guardrails.eligibleForProspectiveSeal,false);
  assert.equal(d.guardrails.officialNumberedCardStillRequired,true);
});
