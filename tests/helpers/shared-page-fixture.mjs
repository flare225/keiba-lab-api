// All index/meeting/card pages below are SYNTHETIC. They are not JRA captures.
import {DatabaseSync} from 'node:sqlite';
import {ensureCollectionTables} from '../../src/history-collection-v3.37.0.js';
import {initializeSharedPageStore,canonicalPublishedPage} from '../../src/shared-page-acquisition.js';
export const FIXTURE_STAMP=Date.parse('2026-10-23T09:30:00Z'),SCOPE='2026-10-23';
export const INDEX=canonicalPublishedPage('https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3');
export const calendar=date=>`https://www.jra.go.jp/keiba/calendar2026/2026/10/${date.slice(5).replace('-','')}.html`;
const venueCode={'東京':'05','京都':'08','新潟':'04'};
export const cardUrl=r=>canonicalPublishedPage(`https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde01${venueCode[r.venue]}20260408${String(r.raceNo).padStart(2,'0')}${r.date.replaceAll('-','')}/AA`);
export const meetingUrl=r=>canonicalPublishedPage(`https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dle${r.date.replaceAll('-','')}${venueCode[r.venue]}/AA`);
export function racesFixture(days=2){const races=[];for(const date of ['2026-10-24','2026-10-25'].slice(0,days))for(const venue of ['東京','京都','新潟'])for(let raceNo=1;raceNo<=12;raceNo++)races.push({date,venue,raceNo,startAt:`${date}T${String(9+Math.floor((raceNo+1)/2)).padStart(2,'0')}:${raceNo%2?'45':'15'}:00+09:00`,enqueuedAt:new Date(FIXTURE_STAMP).toISOString(),rootUrl:calendar(date)});return races;}
export function drawnHtml(r){return `<h1>${r.date.split('-').map(Number).join('年').replace(/年(\d+)年/,'年$1月')}日 ${r.venue}<img alt="${r.raceNo}レース"></h1><h2>隔離検証</h2><p>芝1600m 出走頭数：2頭</p><table>${[1,2].map(no=>`<tr><td>${no}</td><td>${no}</td><td><a>${no===1?'テストア':'テストイ'}</a>父：テスト 母：テスト</td><td>牡2 55kg <a>山田</a></td></tr>`).join('')}</table>`;}
export function pageGraph(races,{nested=false}={}){const pages=new Map(),anchor=url=>`<a href="${url}">published</a>`;
 for(const r of races)pages.set(calendar(r.date),anchor(INDEX));
 if(nested){const groups=[...new Set(races.map(meetingUrl))];pages.set(INDEX,groups.map(anchor).join(''));for(const m of groups)pages.set(m,races.filter(r=>meetingUrl(r)===m).map(r=>anchor(cardUrl(r))).join(''));}
 else pages.set(INDEX,races.map(r=>anchor(cardUrl(r))).join(''));
 for(const r of races)pages.set(cardUrl(r),drawnHtml(r));return pages;
}
export async function fixtureDatabase(){
 const sql=new DatabaseSync(':memory:'),stats={statements:0,returnedRows:0,changedRows:0,readJsonBytes:0,executed:[]};
 const db={prepare(q){const w=(args=[])=>({bind(...a){return w(a)},async all(){stats.statements++;stats.executed.push(q);const rows=sql.prepare(q).all(...args);stats.returnedRows+=rows.length;stats.readJsonBytes+=Buffer.byteLength(JSON.stringify(rows));return{results:rows};},async first(){const r=await this.all();return r.results[0]||null;},async run(){stats.statements++;stats.executed.push(q);const r=sql.prepare(q).run(...args),changes=/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(q)?Number(r.changes):0;stats.changedRows+=changes;return{meta:{changes}};}});return w();},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await ensureCollectionTables(db);await initializeSharedPageStore(db);
 sql.exec('CREATE TABLE jra_races(race_key TEXT PRIMARY KEY,race_date TEXT NOT NULL,venue TEXT NOT NULL,race_no INTEGER NOT NULL,race_name TEXT,surface TEXT,distance INTEGER,source_url TEXT,runner_count INTEGER NOT NULL DEFAULT 0,fetched_at TEXT NOT NULL,UNIQUE(race_date,venue,race_no));CREATE TABLE jra_runners(race_key TEXT NOT NULL,horse_no INTEGER NOT NULL,frame_no INTEGER,horse_name TEXT NOT NULL,sex TEXT,age INTEGER,assigned_weight REAL,jockey TEXT,trainer TEXT,fetched_at TEXT NOT NULL,PRIMARY KEY(race_key,horse_no));');
 const reset=()=>{stats.statements=stats.returnedRows=stats.changedRows=stats.readJsonBytes=0;stats.executed=[];};reset();return{db,sql,stats,reset};
}
export function fixtureFetcher(pages,requests=[]){return async(url,options)=>{const actual=options?.method==='POST'?canonicalPublishedPage(url+'?'+options.body):canonicalPublishedPage(url);requests.push(actual);if(!pages.has(actual))throw Error('Unexpected fixture page '+actual);return new Response(pages.get(actual),{headers:{'content-type':'text/html;charset=utf-8'}});};}
