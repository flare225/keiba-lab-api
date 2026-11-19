import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfirmedPredraw,saveConfirmedPredraw,readConfirmedPredraw} from '../src/confirmed-predraw-roster.js';
import {expectedHistoryContext} from '../src/expected-history-collection-v3.46.0.js';
const url='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604031120261010/9E';
const target={date:'2026-10-10',venue:'東京',raceNo:11,snapshotId:'test',names:['除外馬'],age:2};
const row='<tr><td class="waku"></td><td class="num"></td><td class="horse"><div class="name"><span><img alt="マルガイ"></span><a href="/JRADB/accessU.html?CNAME=pw01dud002024105444/69">出走馬</a></div></td><td class="jockey"><p class="age">牡2/黒鹿</p><p class="weight">56.0<span>kg</span></p><p class="jockey">今の騎手</p></td><td class="past"><p class="weight">55kg</p><p class="jockey">前走騎手</p></td></tr>';
const html='<table><caption>2026年10月10日 東京<img alt="11レース"></caption><thead></thead><tbody>'+row+'</tbody></table>';
test('pre-draw roster keeps source riders and weights, without fabricated numbers',()=>{const r=parseConfirmedPredraw(html,url,target).runners[0];assert.equal(r.jockey,'今の騎手');assert.equal(r.assigned_weight,56);assert.equal(r.age,2);assert.equal(r.horse_no,null);assert.equal(r.frame_no,null);});
test('history-only roster may retain unpublished connections as null, but never relaxes identity or numbers',()=>{
 const options={allowUnassignedConnections:true},missing=html.replace('今の騎手','').replace('56.0','未定');
 const r=parseConfirmedPredraw(missing,url,target,options).runners[0];assert.equal(r.jockey,null);assert.equal(r.assigned_weight,null);assert.equal(r.horse_no,null);assert.equal(r.age,2);
 assert.throws(()=>parseConfirmedPredraw(missing,url,target));
 for(const bad of [missing.replace('牡2/黒鹿','未定'),missing.replace('class="num"></td>','class="num">1</td>'),missing.replace('未定','100')])assert.throws(()=>parseConfirmedPredraw(bad,url,target,options));
});
test('official JRA sex-age accepts the published せん spelling and preserves its source value',()=>{
 const gelding=html.replace('牡2/黒鹿','せん4/鹿').replace('出走馬','セン馬');
 const r=parseConfirmedPredraw(gelding,url,target,{allowUnassignedConnections:true}).runners[0];
 assert.equal(r.horse_name,'セン馬');assert.equal(r.sex,'せん');assert.equal(r.age,4);
});
test('rejects wrong source identity, partial numbering, duplicate rows and incomplete fields',()=>{for(const h of [html.replace('2026年10月10日','2026年10月11日'),html.replace('alt="11レース"','alt="12レース"'),html.replace('class="num"></td>','class="num">1</td>'),html.replace(row,row+row),html.replace('56.0','未定'),html.replace('今の騎手','')])assert.throws(()=>parseConfirmedPredraw(h,url,target));assert.throws(()=>parseConfirmedPredraw(html,url.replace('www.jra.go.jp','example.com'),target));});
test('isolated saved confirmed roster supplies history context and excludes withdrawn expected horses',async()=>{let saved;const queries=[];const db={prepare(q){queries.push(q);return{bind(...args){return{async run(){saved={race_key:args[0],source_url:args[1],source_sha256:args[2],runners_json:args[3],checked_at:args[4]};},async first(){return saved;}}},async run(){}}}};await saveConfirmedPredraw(db,html,url,target);assert.equal((await readConfirmedPredraw(db,target)).runners.length,1);const c=await expectedHistoryContext(db,target);assert.equal(c.rosterBasis,'confirmed-predraw');assert.equal(c.runners[0].horse_name,'出走馬');assert.equal(c.race.race_key,'expected:test');assert.ok(queries.every(q=>!q.includes('jra_runners')&&!q.includes('jra_races')));});
test('predraw retains a marked overseas runner missing a JRA profile and coat',()=>{
 const overseas=row.replace(/<div class="name">.*?<\/div>/,'<div class="name"><span><img src="/JRADB/img/kigo/kaku-gai.png" alt="カクガイ"></span>エルデナリ</div><p class="trainer">調教師<span class="division">(本会外)</span></p>').replace('牡2/黒鹿','せん3');
 const body=html.replace(row,row+overseas),options={allowUnassignedConnections:true};
 const {runners}=parseConfirmedPredraw(body,url,target,options);
 assert.equal(runners.length,2);assert.deepEqual(runners[1],{horse_name:'エルデナリ',age:3,sex:'せん',jockey:'今の騎手',assigned_weight:56,profile_url:null,horse_no:null,frame_no:null});
 for(const bad of [body.replace('カクガイ','マルガイ'),body.replace('(本会外)','(栗東)'),body.replace('せん3','未定')])assert.throws(()=>parseConfirmedPredraw(bad,url,target,options));
 assert.throws(()=>parseConfirmedPredraw(body,url,target));
});
