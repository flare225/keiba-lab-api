const MARK_WEIGHT={'◎':5,'○':4,'▲':3,'△':2,'☆':1};
const n=v=>v==null?null:Number(v);
export function userMarkMap(revision){const m=new Map();for(const x of revision?.marked||revision?.audit?.marked||[])m.set(Number(x.horseNo),x.mark);return m}
export function counterevidence(prediction,userRevision){
 const um=userMarkMap(userRevision),alerts=[];
 for(const r of prediction?.runners||[]){const mark=um.get(Number(r.horseNo));if(!mark)continue;const c=r.components||{};const weak=[];
  for(const [k,label] of [['track','馬場'],['pace','展開'],['position','位置取り'],['distance','距離'],['course','コース'],['workout','追い切り']]){const v=n(c[k]);if(v!=null&&v<0)weak.push({factor:k,label,value:v})}
  const disagreement=Number.isFinite(r.rank)&&MARK_WEIGHT[mark]&&r.rank>Math.max(5,7-MARK_WEIGHT[mark]);
  if(weak.length||disagreement)alerts.push({horseNo:r.horseNo,horseName:r.horseName,userMark:mark,laboRank:r.rank,laboScore:r.score,severity:weak.length>=2||disagreement?'high':'watch',reasons:[...weak.map(x=>`${x.label}評価が弱い`),...(disagreement?[`USER ${mark}に対してLABO順位${r.rank}位`]:[])]});
 }
 return alerts;
}
export function missedHorses(prediction,userRevision){const um=userMarkMap(userRevision);return (prediction?.runners||[]).filter(r=>r.rank<=5&&!um.has(Number(r.horseNo))).map(r=>({horseNo:r.horseNo,horseName:r.horseName,laboRank:r.rank,laboScore:r.score,alert:'USER無印・LABO上位。切る前に再確認'}));}
export function scenarioMatrix(prediction){
 const tracks=['良','稍重','重'],paces=['slow','average','high'];
 return tracks.flatMap(track=>paces.map(pace=>({track,pace,runners:(prediction?.runners||[]).map(r=>{const c=r.components||{};let delta=0;if(track==='重')delta+=n(c.heavy)||0;if(track==='稍重')delta+=(n(c.heavy)||0)*0.5;if(pace==='high')delta+=n(c.highPace)||0;if(pace==='slow')delta+=n(c.slowPace)||0;return{horseNo:r.horseNo,horseName:r.horseName,baseRank:r.rank,baseScore:r.score,scenarioDelta:Math.round(delta*100)/100,scenarioScore:r.score==null?null:Math.round((Number(r.score)+delta)*100)/100}}).sort((a,b)=>(b.scenarioScore??-999)-(a.scenarioScore??-999)).map((r,i)=>({...r,scenarioRank:i+1}))})));
}
export function whyLog(prediction,userRevision){const um=userMarkMap(userRevision);return (prediction?.runners||[]).filter(r=>r.rank<=5||um.has(Number(r.horseNo))).map(r=>({horseNo:r.horseNo,horseName:r.horseName,userMark:um.get(Number(r.horseNo))||null,laboRank:r.rank,laboScore:r.score,components:r.components||null,why:`LOCK時点 LABO ${r.rank}位${um.has(Number(r.horseNo))?` / USER ${um.get(Number(r.horseNo))}`:''}`,immutableBasis:true}));}
export function buildDecisionLab(prediction,userRevision){if(!prediction?.available)return{available:false,reason:'immutable LABO prediction unavailable'};return{available:true,counterevidence:counterevidence(prediction,userRevision),missedHorses:missedHorses(prediction,userRevision),scenarios:scenarioMatrix(prediction),why:whyLog(prediction,userRevision),guardrails:{preResultInputsOnly:true,resultLeakage:false,automaticWeightMutation:false,lockedPredictionMutation:false}}}
