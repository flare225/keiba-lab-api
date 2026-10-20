import {targetInput} from './race-history-assessment-v3.31.0.js';
import {resolveExpectedCollectionSource} from './index-v3.46.0.js';
import {deriveRaceReadiness} from './readiness-v3.13.0.js';
export const PRECARD_STATE_PATHS=new Set(['/v1/lab/race-ops','/v1/lab/race-readiness','/v1/lab/prelock-audit','/v1/lab/decision-lab','/v1/lab/labo-prediction','/v1/lab/race-alerts']);
export async function readPrecardRaceState(db,input){
 let t;try{t=targetInput(input)}catch{return{status:400,data:{ok:false,error:'対象レースの日付・競馬場・レース番号を確認してください。'}};}const args=[t.date,t.venue,t.raceNo];
 const official=await db.prepare('SELECT race_key FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(...args).first();if(official)return null;
 const source=await resolveExpectedCollectionSource(db,t);
 const program=await db.prepare('SELECT race_date,venue,race_no FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=?').bind(...args).first();
 if(!source&&!program)return{status:404,data:{ok:false,status:'unknown-race',error:'対象レースの開催情報・想定名簿は未保存です。'}};
 const count=source?.names.length||0,message=count?'想定名簿'+count+'頭は保存済みです。正式な枠番・馬番付き出馬表は未保存です。':'開催情報は保存済みです。想定名簿と正式出馬表は未保存です。';
 const audit={passed:false,declared:0,stored:0,blockers:['正式な枠番・馬番付き出馬表が未保存です。'],sourceVerified:false};
 const readiness=deriveRaceReadiness();if(count)readiness.stages.unshift({id:'expected-roster',label:'想定名簿 '+count+'頭',ready:true});
 return{status:200,data:{ok:true,status:'awaiting-official-card',message,race:{raceKey:`${t.date}:${t.venue}:${t.raceNo}`,...t,raceName:source?.raceName||'',runnerCount:0},precard:{available:count>0,runnerCount:count,snapshotId:source?.snapshotId||null,officialIdentityVerified:false},storage:{storedRunnerRows:0,resultRows:0},readiness,audit,gate:'BLOCK_PRELOCK',prelock:{gate:'BLOCK_PRELOCK',audit},ops:{cardComplete:false,prelockAllowed:false,predictionReady:false,userMarkReady:false,decisionReady:false,preRaceReady:false,alertStatus:'WAIT',nextAction:'WAIT_OFFICIAL_CARD'},prediction:{available:false,locked:false,hashVerified:false},userMark:{available:false,latestRevision:null},decisionLab:{available:false,counterevidence:[],missedHorses:[]},alerts:{status:'WAIT',alerts:[{code:'OFFICIAL_CARD_PENDING',severity:'info',message}]},guardrails:{officialCardBeforeLock:true,noSyntheticCompletion:true,externalRequests:0,readOnly:true}}};
}
