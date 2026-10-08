import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePastPerformances} from '../src/collection-profile-parser-v3.32.0.js';
import {collectionDue,COLLECTION_POLICY} from '../src/history-collection-v3.37.0.js';
import {completeCollectedTraining} from '../src/history-learning-completion.js';
const now=Date.parse('2026-10-09T00:00:00Z');
const row=(date,distance)=>'<tr>'+[date,'園田','未勝利',distance,'良','8','1','1','騎手','55','475','50.7','','勝馬'].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
test('JRA-published three-digit local distances are preserved, with the same strict date cutoff',()=>{
 const html='<table>'+row('2026年8月21日','ダ820')+row('2026年10月3日','芝1400')+row('2026年9月1日','ダ8200')+row('2026年9月2日','ダ82000')+'</table>';
 const r=parsePastPerformances(html,'ルジュエ','https://www.jra.go.jp/profile','2026-10-03',10);assert.equal(r.length,1);assert.equal(r[0].distance,820);assert.equal(r[0].venue,'園田');assert.equal(r[0].finishPosition,1);
});
test('zero-row past receipts can recover daily without refetching already successful archives',()=>{
 const rec={policy_version:COLLECTION_POLICY.version,requested_limit:10,status:'checked',rows_found:0,checked_at:now-86400000};
 assert.equal(collectionDue(rec,'2026-10-03',10,now),true);assert.equal(collectionDue({...rec,checked_at:now-86399999},'2026-10-03',10,now),false);assert.equal(collectionDue({...rec,rows_found:2},'2026-10-03',10,now),false);
});
test('newly supplemented training race is captured immediately and fitted only after labels verify',async()=>{
 const result={ok:true,before:{race:{date:'2026-10-03',venue:'京都',raceNo:9}},results:[{savedRows:2}],externalRequests:1};let fits=0;
 const completed=await completeCollectedTraining({},result,now,{capture:async(db,race,stamp)=>{assert.equal(race.raceNo,9);assert.equal(stamp,now);return{status:'labels-saved'};},fit:async()=>{fits++;return{trainingRaces:23}}});
 assert.equal(completed.learningCompletion.fit.trainingRaces,23);assert.equal(completed.externalRequests,1);assert.equal(fits,1);
 const pending=await completeCollectedTraining({},result,now,{capture:async()=>({status:'awaiting-prior-history'}),fit:async()=>{throw Error('must not fit')}});assert.equal(pending.learningCompletion.status,'awaiting-prior-history');
 for(const r of [{...result,results:[{savedRows:0}]},{...result,before:{race:{...result.before.race,date:'2026-10-10'}}}])assert.equal(await completeCollectedTraining({},r,now,{capture:async()=>{throw Error('must not capture')}}),r);
 const failed=await completeCollectedTraining({},result,now,{capture:async()=>{throw Error('DB unavailable')}});assert.equal(failed.ok,true);assert.equal(failed.learningCompletion.status,'deferred');
});
