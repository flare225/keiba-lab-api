import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index-v3.8.5.js';
import {parsePrecardHorsePage,shouldRefreshPrecard,DEFAULT_PRECARD_TARGETS} from '../src/precard-context-v3.8.5.js';

const PUBLISHED=`<!doctype html><html><body>
<h1>サウジアラビアロイヤルカップ</h1><p>2026年10月10日（土曜） 東京競馬場 1,600メートル（芝）</p>
<h2>出走馬情報</h2>
<h3><a href="#a">アルファスター</a></h3>
<p>牡2歳</p><p>調教師：山田 太郎（美浦）</p>
<ul><li>父：キタサンブラック</li><li>母：アルファムーン</li><li>母の父：ロードカナロア</li></ul>
<p>ここに注目！ 新馬戦では好位から鋭く伸びた。</p>
<h3>ベータキング</h3>
<p>牡2歳</p><p>調教師：佐藤 次郎（栗東）</p>
<ul><li>父：エピファネイア</li><li>母：ベータベル</li><li>母の父：ディープインパクト</li></ul>
<p>ここに注目！ 東京替わりが鍵。</p>
</body></html>`;

test('published JRA-style horse page parses isolated two-year-old context',()=>{
 const d=parsePrecardHorsePage(PUBLISHED,{expectedRaceName:'サウジアラビアロイヤルカップ',expectedDate:'2026-10-10'});
 assert.equal(d.published,true);
 assert.equal(d.placeholder,false);
 assert.equal(d.horses.length,2);
 assert.deepEqual(d.horses[0],{
  name:'アルファスター',sex:'牡',age:2,trainer:'山田 太郎',stable:'美浦',sire:'キタサンブラック',dam:'アルファムーン',damsire:'ロードカナロア',focus:'新馬戦では好位から鋭く伸びた。'
 });
 assert.equal(d.warnings.length,0);
});

test('publication placeholder is explicit and never masquerades as empty published field',()=>{
 const html='<h1>サウジアラビアロイヤルカップ</h1><p>2026年10月10日（土曜）</p><h2>出走馬情報</h2><p>サウジアラビアロイヤルカップの出走馬情報は、2026年10月6日（火曜）に公開予定です。</p>';
 const d=parsePrecardHorsePage(html,{expectedRaceName:'サウジアラビアロイヤルカップ',expectedDate:'2026-10-10'});
 assert.equal(d.placeholder,true);
 assert.equal(d.published,false);
 assert.equal(d.horses.length,0);
});

test('wrong race identity is rejected before context can be saved',()=>{
 assert.throws(()=>parsePrecardHorsePage(PUBLISHED,{expectedRaceName:'毎日王冠',expectedDate:'2026-10-10'}),/race-name mismatch/);
 assert.throws(()=>parsePrecardHorsePage(PUBLISHED,{expectedRaceName:'サウジアラビアロイヤルカップ',expectedDate:'2026-10-11'}),/race-date mismatch/);
});

test('precard refresh starts on publication date and backs off to six hours after success',()=>{
 const base={...DEFAULT_PRECARD_TARGETS[0],race_key:'2026-10-10:東京:11',race_date:'2026-10-10',not_before:'2026-10-06',enabled:1,last_success_at:null};
 assert.equal(shouldRefreshPrecard(base,new Date('2026-10-05T15:00:00+09:00')),false);
 assert.equal(shouldRefreshPrecard(base,new Date('2026-10-06T00:01:00+09:00')),true);
 const fresh={...base,last_success_at:'2026-10-06T00:00:00+09:00'};
 assert.equal(shouldRefreshPrecard(fresh,new Date('2026-10-06T05:59:00+09:00')),false);
 assert.equal(shouldRefreshPrecard(fresh,new Date('2026-10-06T06:01:00+09:00')),true);
 assert.equal(shouldRefreshPrecard(fresh,new Date('2026-10-11T00:01:00+09:00')),false);
});

test('v3.8.5 deploy check identifies isolated precard build',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/deploy-check'),{},{});
 const d=await r.json();
 assert.equal(r.status,200);
 assert.equal(d.version,'3.8.5');
 assert.equal(d.build,'precard-context-isolation-and-official-card-diff');
});

test('write endpoint requires POST before D1 is touched',async()=>{
 const r=await worker.fetch(new Request('https://test/v1/lab/precard-context-ingest'),{},{});
 const d=await r.json();
 assert.equal(r.status,500);
 assert.match(d.error,/D1 binding/);
});
