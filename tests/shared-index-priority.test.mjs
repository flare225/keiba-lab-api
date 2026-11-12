import test from 'node:test';import assert from 'node:assert/strict';
import {runSharedPageStep,planSharedPages,SHARED_PAGE_POLICY,canonicalPublishedPage} from '../src/shared-page-acquisition.js';
import {fixtureDatabase,racesFixture,cardUrl,drawnHtml,INDEX} from './helpers/shared-page-fixture.mjs';
// These two links were observed together in the 2026-11-04 18:42:52 JST
// stored alphabetical source SHA 625f65e9dabdb6c2a95ab1118758ace7db5664a12d718186736c50c11a5fed6a.
// HTML/card contents below are synthetic; no production source is refetched.
const alphabetical=canonicalPublishedPage('https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01d5000A1/1B');
const sibling=canonicalPublishedPage('https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01d5000A2/65');
const stamp=Date.parse('2026-11-04T18:42:52+09:00');
test('published race index precedes alphabetical branches at equal deadline and reaches a saved formal card in existing slots',async()=>{
 const {db,sql}=await fixtureDatabase();let now=stamp;const requested=[];
 const race={...racesFixture()[0],date:'2026-11-07',venue:'京都',raceNo:11,startAt:'2026-11-07T15:40:00+09:00',enqueuedAt:new Date(stamp).toISOString(),rootUrl:alphabetical};
 const card=cardUrl(race),pages=new Map([[alphabetical,`<a href="${sibling}">next alphabetical group</a><a href="${INDEX}">published race index</a>`],[INDEX,`<a href="${card}">published matching card</a>`],[card,drawnHtml(race)]]);
 const fetcher=async(url,options)=>{const actual=canonicalPublishedPage(options?.method==='POST'?url+'?'+options.body:url);requested.push(actual);assert.ok(pages.has(actual),'must follow the published index before an alphabetical sibling: '+actual);return new Response(pages.get(actual),{headers:{'content-type':'text/html;charset=utf-8'}});};
 for(let i=0;i<3;i++){const out=await runSharedPageStep(db,{scope:race.date,races:[race]},{now:()=>now,fetcher});assert.equal(out.externalRequests,1);now+=61000;}
 assert.deepEqual(requested,[alphabetical,INDEX,card]);assert.equal(sql.prepare('SELECT runner_count FROM jra_races').get().runner_count,2);assert.equal(sql.prepare('SELECT count(*) n FROM jra_runners').get().n,2);sql.close();
});

test('published-index tie break cannot override urgency, retry deadlines or invent an unobserved index',()=>{
 const race=(venue,no,startAt)=>({date:'2026-11-07',venue,raceNo:no,startAt,start:Date.parse(startAt),enqueued:stamp,rootUrl:sibling});
 const a=race('京都',11,'2026-11-07T15:40:00+09:00'),b={...race('東京',1,'2026-11-07T09:50:00+09:00'),rootUrl:INDEX};
 const row={page_url:INDEX,status:'parsed',body_sha:'a',observed_at:stamp,parser_version:SHARED_PAGE_POLICY.parserVersion,findings_json:'{"pages":[],"cards":[]}',next_at:stamp+3600000};
 assert.deepEqual(planSharedPages([a,b],[row],stamp).jobs.map(j=>j.url),[sibling]);
 const late={...b,start:stamp+7200000};assert.equal(planSharedPages([a,late],[],stamp).jobs[0].url,INDEX);
 const only=planSharedPages([a],[],stamp);assert.deepEqual(only.jobs.map(j=>j.url),[sibling]);
});
