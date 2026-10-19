import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {nextConfirmedPredrawSource} from '../src/confirmed-predraw-history-source.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE lab_confirmed_predraw_rosters(race_key TEXT PRIMARY KEY,source_url TEXT,source_sha256 TEXT,runners_json TEXT,checked_at TEXT)');const db={prepare(q){const w=(a=[])=>({bind(...b){return w(b)},async all(){return{results:sql.prepare(q).all(...a)}},async run(){return sql.prepare(q).run(...a)}});return w()}};return{sql,db}}
const now=Date.parse('2026-10-19T00:15:00Z'),profile='https://www.jra.go.jp/JRADB/accessU.html?CNAME=pw01dud002024100001/AA';
const card=no=>'https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde010520260404'+String(no).padStart(2,'0')+'20261024/AA';
function add(sql,no,overrides={}){const values={key:'2026-10-24:東京:'+no,url:card(no),sha:'a'.repeat(64),runners:[{horse_name:'Horse'+no,age:2,horse_no:null,frame_no:null,profile_url:profile}],at:new Date(now-1000).toISOString(),...overrides};sql.prepare('INSERT INTO lab_confirmed_predraw_rosters VALUES(?,?,?,?,?)').run(values.key,values.url,values.sha,JSON.stringify(values.runners),values.at)}
test('official pre-draw races enter a fair bounded queue without static race configuration',async()=>{
 const {db,sql}=fixture();add(sql,1);add(sql,11);
 const a=await nextConfirmedPredrawSource(db,now),b=await nextConfirmedPredrawSource(db,now+1),c=await nextConfirmedPredrawSource(db,now+2);
 assert.equal(a.raceNo,1);assert.equal(b.raceNo,11);assert.equal(c.raceNo,1);assert.equal(a.rosterBasis,'confirmed-predraw');assert.deepEqual(a.names,['Horse1']);assert.equal(a.snapshotId,'confirmed-predraw:2026-10-24:東京:1');assert.equal(sql.prepare('SELECT COUNT(*) n FROM lab_predraw_history_dispatch').get().n,2);sql.close();
});
test('wrong source identity, future observations and invented numbers cannot enter history queue',async()=>{
 for(const override of [{url:'https://example.com/card'},{key:'2026-10-24:京都:1'},{sha:'bad'},{at:new Date(now+1).toISOString()},{runners:[{horse_name:'Horse1',age:2,horse_no:1,frame_no:1,profile_url:profile}]},{runners:[{horse_name:'Horse1',age:2,profile_url:'https://example.com/profile'}]}]){const {db,sql}=fixture();add(sql,1,override);assert.equal(await nextConfirmedPredrawSource(db,now),null);sql.close();}
});
