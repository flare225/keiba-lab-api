import test from 'node:test';
import assert from 'node:assert/strict';
import {runSharedPageStep,canonicalPublishedPage} from '../src/shared-page-acquisition.js';
import {collectLiveHistory} from '../src/live-source-dispatch.js';
import {collectUpcomingOfficialHistory} from '../src/upcoming-official-history.js';
import {collectHistoryBatch} from '../src/history-collection-v3.37.0.js';
import {ensureHistoryTable} from '../src/collection-profile-parser-v3.32.0.js';
import {scheduledAutomaticPrediction,readAutomaticPrediction} from '../src/automatic-pre-race-prediction.js';
import {scheduledSavedAutomaticSeal} from '../src/saved-automatic-seal-queue.js';
import {readSavedAutomaticSeal} from '../src/saved-automatic-seal.js';
import {ensureProspectiveSealTables} from '../src/prospective-seal-store.js';
import {sha256} from '../src/card-evidence.js';
import {fixtureDatabase,INDEX,cardUrl,drawnHtml,fixtureFetcher} from './helpers/shared-page-fixture.mjs';

// Synthetic pages only: exercise the combined acquisition/history/forecast/LOCK
// path against one SQLite store, rather than counting separate unit successes.
for(const stored of [false,true])test('current-week '+(stored?'verified cached':'profile')+' formal-only acquisition reaches stored history, independent forecast and immutable pre-start LOCK',async()=>{
 const {db,sql}=await fixtureDatabase();let now=Date.parse('2026-11-04T19:00:00+09:00');
 const race={date:'2026-11-07',venue:'京都',raceNo:11,startAt:'2026-11-07T15:40:00+09:00',enqueuedAt:new Date(now).toISOString(),rootUrl:canonicalPublishedPage('https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01d5000A1/1B')};
 const key='2026-11-07:京都:11',card=cardUrl(race),requests=[];
 const profiles=['https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002021105521/7D','https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002021105522/7E'];
 let html=drawnHtml(race).replace('<a>テストア',`<a href="${profiles[0]}">テストア`).replace('<a>テストイ',`<a href="${profiles[1]}">テストイ`);
 if(stored){
  const cells=[10,9,8].map((m,i)=>'<td class="past p'+(i+1)+'"><div class="date">2026年'+m+'月1日</div><div class="rc">京都</div><div class="name">合成過去走</div><div class="place">2着</div><span class="max">12頭</span><span class="dist">1600芝</span><p class="time">1:34.1</p><span class="condition">良</span><div class="f3">3F 34.1</div></td>').join('');
  html=html.replaceAll('<td><a href=','<td class="horse"><div class="name_line"><div class="name"><a href=').replaceAll('</a>父：','</a></div></div>父：').replaceAll('</tr>',cells+'</tr>');
 }
 const pages=new Map([[race.rootUrl,`<a href="${INDEX}">race index</a>`],[INDEX,`<a href="${card}">matching card</a>`],[card,html]]);
 for(let i=0;i<3;i++){await runSharedPageStep(db,{scope:race.date,races:[race]},{now:()=>now,fetcher:fixtureFetcher(pages,requests)});now+=61000;}
 assert.deepEqual(requests,[race.rootUrl,INDEX,card]);
 assert.equal(sql.prepare('SELECT runner_count FROM jra_races WHERE race_key=?').get(key).runner_count,2);
 assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('lab_expected_roster_registry','lab_confirmed_predraw_rosters')").get().n,0);
 await ensureHistoryTable(db);
 sql.exec('CREATE TABLE jra_race_program(program_key TEXT PRIMARY KEY,race_date TEXT,venue TEXT,race_no INTEGER,start_time TEXT,source_url TEXT);CREATE TABLE lab_race_outcomes(race_key TEXT,horse_no INTEGER,finish_position INTEGER);CREATE TABLE lab_race_result_details(race_key TEXT,horse_no INTEGER,finish_position INTEGER,finish_status TEXT,time_text TEXT,time_seconds REAL,corner_positions TEXT,last3f REAL,source_url TEXT)');
 sql.prepare('INSERT INTO jra_race_program VALUES(?,?,?,?,?,?)').run(key,race.date,race.venue,11,'15:40',INDEX);
 let historyRequests=0;
 for(const name of (stored?['両馬']:['テストア','テストイ'])){
  const history='<h1>'+name+'</h1><table>'+['2026年10月3日','2026年9月1日','2026年8月1日'].map(d=>'<tr>'+[d,'京都','合成過去走','芝1600','良','12','2','1','山田','55','480(+2)','1:34.1','111','勝馬'].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
  const out=await collectLiveHistory(db,{scheduledTime:now},{now:()=>now,cardCompletionFirst:true,previousHistoryWorkStage:'acquisition',previousCardSelection:{lane:'card',target:key,priorityFormalHistoryPending:true},cards:()=>assert.fail('must hand off to stored formal card history'),upcoming:(database,options)=>collectUpcomingOfficialHistory(database,{...options,collect:(d,input,deps)=>collectHistoryBatch(d,input,{...deps,wait:async()=>{},fetcher:async(url,options)=>{historyRequests++;assert.equal(new URL(url).pathname,'/JRADB/accessU.html');assert.equal(new URLSearchParams(options.body).get('CNAME'),new URL(profiles[historyRequests-1]).searchParams.get('CNAME'));return new Response(history,{headers:{'content-type':'text/html;charset=utf-8'}});}})})});
  assert.equal(out.addedRows,stored?6:3,JSON.stringify(out));assert.equal(out.externalRequests,stored?0:1);now+=61000;
 }
 assert.equal(historyRequests,stored?0:2);assert.equal(sql.prepare('SELECT count(*) n FROM jra_past_performances').get().n,6);
 const saved=await scheduledAutomaticPrediction(db,now);assert.equal(saved.saved,1,JSON.stringify(saved));
 const independent=await readAutomaticPrediction(db,race);assert.equal(independent.integrityVerified,true);assert.equal(await sha256(JSON.stringify(independent.snapshot)),saved.snapshotSha256);
 now+=61000;await ensureProspectiveSealTables(db);
 const locked=await scheduledSavedAutomaticSeal(db,{enabled:true,now:()=>now});assert.equal(locked.sealed,1,JSON.stringify(locked));
 const seal=await readSavedAutomaticSeal(db,race);assert.equal(seal.integrityVerified,true);assert.deepEqual(seal.snapshot,independent.snapshot);
 const before=sql.prepare('SELECT * FROM lab_prospective_seals').get();
 await scheduledSavedAutomaticSeal(db,{enabled:true,now:()=>Date.parse(race.startAt)+1000});
 assert.deepEqual(sql.prepare('SELECT * FROM lab_prospective_seals').get(),before);sql.close();
});
