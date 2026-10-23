// Local SQLite and synthetic response replay only. Never contacts JRA/Worker.
import {writeFile} from 'node:fs/promises';
import {discoverExpectedCard} from '../src/expected-card-discovery.js';
import {runSharedPageStep} from '../src/shared-page-acquisition.js';
import {fixtureDatabase,racesFixture,pageGraph,fixtureFetcher,FIXTURE_STAMP,SCOPE} from '../tests/helpers/shared-page-fixture.mjs';
function counts(sql){return sql.prepare('SELECT race_date,venue,COUNT(*) races FROM jra_races GROUP BY race_date,venue ORDER BY race_date,venue').all();}
async function replay(mode,{days=2,nested=false,cadenceMs=61000,deadlines=false}={}){
 const f=await fixtureDatabase(),races=racesFixture(days),requests=[],pages=pageGraph(races,{nested});let now=FIXTURE_STAMP,deliveries=0;const started=performance.now();
 const deps={now:()=>now,fetcher:fixtureFetcher(pages,requests)};
 if(mode==='legacy'){
  for(const r of races.slice().sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)||a.venue.localeCompare(b.venue))){
   const source={...r,snapshotId:`official-card:${r.date}:${r.venue}:${r.raceNo}:official-program`,officialRosterDiscoveryUrl:r.rootUrl};
   for(let stage=0;stage<3;stage++){
    if(deadlines&&now>=Date.parse(r.startAt)-300000)break;
    const result=await discoverExpectedCard(f.db,source,deps);deliveries++;now+=cadenceMs;
    if(result.status==='official-card-saved'||!result.ok)break;
   }
  }
 }else{
  for(let i=0;i<260;i++){
   if(deadlines&&now>Math.max(...races.map(r=>Date.parse(r.startAt)))-300000)break;
   const result=await runSharedPageStep(f.db,{scope:SCOPE,races},deps);deliveries++;
   if(result.status==='complete'||(!result.externalRequests&&result.status==='awaiting-source-or-deadline'))break;
   if(result.status==='deferred'||result.status==='cached-stage-failed'||result.status==='source-storage-budget')throw Error(JSON.stringify(result));
   now+=cadenceMs;
  }
 }
 const formal=Number(f.sql.prepare('SELECT COUNT(*) n FROM jra_races').get().n),bodies=f.sql.prepare('SELECT COUNT(*) versions,COALESCE(SUM(byte_length),0) bytes FROM lab_shared_page_bodies_v1').get(),receiptBytes=f.sql.prepare('SELECT COALESCE(SUM(LENGTH(COALESCE(findings_json,\'\'))),0) bytes FROM lab_shared_page_receipts_v1').get().bytes;
 const result={mode,fixture: nested?'synthetic-nested':'synthetic-flat',days,cadenceMs,deadlines,deliveryAttempts:deliveries,fixtureFetches:requests.length,realExternalRequests:0,uniqueFetchedPages:new Set(requests).size,formalCards:formal,byMeeting:counts(f.sql),elapsedMs:Math.round(performance.now()-started),sqlite:{statements:f.stats.statements,returnedRows:f.stats.returnedRows,changedRows:f.stats.changedRows,readJsonBytes:f.stats.readJsonBytes,sourceBodyVersions:bodies.versions,sourceBodyUtf8Bytes:bodies.bytes,normalizedFindingsCharacters:receiptBytes},d1RowsRead:null,d1AccountUsage:null,predictionsVerified:0,productionSuccesses:0};f.sql.close();return result;
}
const results=[];
for(const days of [1,2])for(const mode of ['legacy','shared'])results.push(await replay(mode,{days}));
for(const mode of ['legacy','shared'])results.push(await replay(mode,{nested:true}));
for(const mode of ['legacy','shared'])results.push(await replay(mode,{cadenceMs:18*60000,deadlines:true}));
const report={generatedAt:new Date().toISOString(),evidence:'Only the existing calendar-to-index DOM excerpt is witnessed; all index/meeting/card content in this replay is synthetic.',scope:'Page acquisition/card persistence only; prediction/GET/UI/LOCK completion is not implied.',initializationExcluded:true,inventoryEnumeration:'Legacy direct discovery and new engine receive the same supplied inventory; active production queue selection and its enumeration cost are not simulated.',results};
await writeFile(new URL('../docs/shared-page-replay-results-20261023.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
