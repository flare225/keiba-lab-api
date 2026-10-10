import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{validDate,matches,validateCard,ingestDay,storageAudit} from '../src/index-v3.7.1.js';
const date='2026-10-10',url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604011120261010%2Ftest';
const meta={date,venue:'東京',raceNo:11,url};
const programs=[{program_key:`${date}:東京:11`,race_date:date,venue:'東京',race_no:11}];
const card={runnerCount:2,runners:[{horseNo:1,name:'テストア'},{horseNo:2,name:'テストイ'}]};
const env={DB:{prepare(){return{bind(){return{all:async()=>({results:programs}),first:async()=>null}}}}}};
function deps(overrides={}){return{inspectSourceCard:()=>({sourceRowCount:2,declaredCount:2,allHorseNumbersObserved:true,allFramesObserved:true,frames:new Map([[1,1],[2,2]])}),saveEvidence:async()=>{},discover:async()=>({found:new Map([[programs[0].program_key,meta]]),errors:[]}),fetchHtml:async()=>({ok:true,url,body:''}),parseRace:()=>card,persistFullDay:async(db,probe)=>{assert.equal(probe.date,date);assert.equal(probe.races.length,1);return{saved:[{raceKey:programs[0].program_key,status:'saved',runnerCount:2}]};},...overrides};}
const request=()=>new Request(`https://test/v1/lab/card-ingest?date=${date}`);
test('valid dates reject normalized and impossible calendar dates',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-99-99'),false);assert.equal(validDate(date),true);});
test('race identity includes exact requested date and venue',()=>{assert.ok(matches(meta,date,'東京',11));assert.equal(matches(meta,'2026-10-11','東京',11),false);});
test('duplicate, gapped or empty runner numbers are refused',()=>{assert.ok(validateCard(card));for(const runners of [[],[{horseNo:1,name:'ア'},{horseNo:1,name:'イ'}],[{horseNo:1,name:'ア'},{horseNo:3,name:'イ'}]])assert.equal(validateCard({...card,runners}),false);});
test('requested future date is persisted once, using confirmed saved target',async()=>{const r=await ingestDay(request(),env,{},deps());assert.ok(r.ok);assert.equal(r.storedRunners,2);});
test('redirect to another race never persists a card',async()=>{let saved=false;const r=await ingestDay(request(),env,{},deps({fetchHtml:async()=>({ok:true,url:url.replace('20261010','20261011')}),persistFullDay:async()=>{saved=true;}}));assert.equal(saved,false);assert.equal(r.ok,false);});
test('missing discovery is not reported as unpublished or successful',async()=>{const r=await ingestDay(request(),env,{},deps({discover:async()=>({found:new Map(),errors:[]})}));assert.equal(r.ok,false);assert.equal(r.runs[0].status,'card-not-discovered');});
test('save acknowledgement from another race is rejected',async()=>{const r=await ingestDay(request(),env,{},deps({persistFullDay:async()=>({saved:[{raceKey:'wrong',status:'saved',runnerCount:2}]})}));assert.equal(r.ok,false);});
test('audit compares runner rows, identifies partial cards',async()=>{
 let query=0;const db={prepare(){return{run:async()=>{},bind(){return{all:async()=>({results:query++===0?[{...programs[0],race_key:programs[0].program_key,runner_count:2,stored_runners:1,unique_runners:1,invalid_runners:0}]:[]})}}}}};
 const r=await storageAudit(db,date,date);assert.equal(r.ok,false);assert.equal(r.allCardsComplete,false);assert.equal(r.totals.runnersStored,1);assert.equal(r.totals.declaredRunners,2);
});
test('range rejects malformed dates rather than silently dropping them',async()=>{const r=await worker.fetch(new Request('https://test/v1/lab/card-ingest-range?dates=2026-10-10,invalid'),env,{});assert.equal(r.status,400);});
test('hourly rotation reaches all three dates and all 24 cards without starving later dates',async()=>{
 const {runScheduled}=await import('../src/index-v3.7.1.js');
 const dates=['2026-10-10','2026-10-11','2026-10-12'],seen=new Set();let staged=0;
 const db={prepare(){return{bind(){return{all:async()=>({results:dates.map(race_date=>({race_date}))})}}}}};
 const deps={today:()=>date,stage:async request=>{assert.equal(new URL(request.url).searchParams.get('dates').split(',').length,8);staged++;return new Response(JSON.stringify({ok:true}));},ingest:async request=>{const u=new URL(request.url),d=u.searchParams.get('date'),cursor=Number(u.searchParams.get('cursor'));for(let i=cursor;i<cursor+8;i++)seen.add(`${d}:${i}`);return{ok:true};}};
 for(let hour=0;hour<9;hour++){const r=await runScheduled({scheduledTime:hour*3600000},{DB:db},{},deps);assert.equal(r.runs.length,2);}
 assert.equal(staged,9);assert.equal(seen.size,72);
});
test('published JRA onclick navigation is decoded without executing JavaScript',async()=>{
 const{extractLinks}=await import('../src/index-v1.1.4.js');
 const links=extractLinks(`<a href="#" onclick="doAction('/JRADB/accessD.html','pw01dli00/F3');return false">出馬表</a><a onclick="doAction('https://evil.test/JRADB/accessD.html','pw01dli00/F3')">外部</a><a onclick="doAction('/JRADB/accessS.html','pw01sli00/AF')">結果</a>`,'https://www.jra.go.jp/keiba/');
 assert.equal(links.length,1);assert.equal(new URL(links[0]).searchParams.get('CNAME'),'pw01dli00/F3');
});
test('JRA literal action uses POST CNAME and preserves source identity',async()=>{
 const{fetchHtml}=await import('../src/index-v1.1.4.js');const original=globalThis.fetch;
 try{globalThis.fetch=async(url,options)=>{assert.equal(options.method,'POST');assert.equal(new URLSearchParams(options.body).get('CNAME'),'pw01dli00/F3');return{ok:true,status:200,url:'https://www.jra.go.jp/JRADB/accessD.html',arrayBuffer:async()=>new TextEncoder().encode('<title>error</title>').buffer};};const page=await fetchHtml('https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00%2FF3');assert.equal(new URL(page.url).searchParams.get('CNAME'),'pw01dli00/F3');assert.ok(page.ok);}finally{globalThis.fetch=original;}
});
test('deployment check reports the active wrapper version',async()=>{const response=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),env,{});assert.equal((await response.json()).version,'3.7.1');});


test('eight staged JRA source pages are all explored rather than starving races 7 and 8',async()=>{
 const {discover}=await import('../src/index-v3.7.1.js');
 const day='2026-10-11',programs=Array.from({length:8},(_,i)=>({venue:'東京',race_no:i+1,source_url:'https://www.jra.go.jp/fixture/page-'+(i+1)}));
 const loaded=[];
 const load=async url=>{
  loaded.push(url);
  const n=Number(url.match(/page-(\d+)$/)?.[1]||0);
  const cname='pw01dde010520260404'+String(n).padStart(2,'0')+'20261011/AA';
  return{ok:true,url,body:n?'<a href="/JRADB/accessD.html?CNAME='+encodeURIComponent(cname)+'">正式出馬表</a>':''};
 };
 const d=await discover(day,programs,{load});
 assert.equal(d.found.size,8);
 assert.equal(d.unresolved.length,0);
 assert.equal(d.pagesVisited,8);
 assert.ok(d.pageLimit>=8);
 assert.equal(loaded.filter(x=>x.includes('/fixture/')).length,8);
});
test('a staged, dated official JRA card URL is discovered without inventing its checksum',async()=>{
 const {discover}=await import('../src/index-v3.7.1.js');
 let calls=0;
 const d=await discover('2026-10-11',[{venue:'東京',race_no:11,source_url:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604041120261011%2FCE'}],{load:async()=>{calls++;throw Error('Should not need discovery fetch');}});
 assert.equal(d.found.size,1);
 assert.equal(d.pagesVisited,0);
 assert.equal(calls,0);
 assert.deepEqual(d.unresolved,[]);
});
test('discovery returns an explicit unresolved race key when no published link can be found',async()=>{
 const {discover}=await import('../src/index-v3.7.1.js');
 const day='2026-10-11',source='https://www.jra.go.jp/fixtures/unknown';
 const d=await discover(day,[{venue:'京都',race_no:8,source_url:source}],{load:async url=>({ok:true,url,body:'<p>リンクは掲載されていない</p>'})});
 assert.deepEqual(d.unresolved,[day+':京都:8']);
 assert.equal(d.found.size,0);
});
