const pct=(a,b)=>b?Math.round(a*1000/b)/10:null;
const pos=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:null};
export function summarizePerformance({locks=[],outcomes=[],userRevisions=[]}={}){
 const finish=new Map(outcomes.map(x=>[`${x.raceKey}:${Number(x.horseNo)}`,pos(x.finishPosition)]));
 const latestLock=new Map();for(const x of [...locks].sort((a,b)=>String(b.sealedAt||'').localeCompare(String(a.sealedAt||''))))if(!latestLock.has(x.raceKey))latestLock.set(x.raceKey,x);
 let races=0,top1Win=0,top1Top3=0,top3Winner=0,top5Winner=0,top1FinishSum=0,top1FinishN=0,missingResults=0;
 const details=[];
 for(const l of latestLock.values()){
  let s;try{s=typeof l.snapshot==='string'?JSON.parse(l.snapshot):l.snapshot}catch{continue}
  const rs=[...(s?.runners||[])].sort((a,b)=>Number(a.rank)-Number(b.rank));if(!rs.length)continue;
  const known=rs.map(r=>({...r,finishPosition:finish.get(`${l.raceKey}:${Number(r.horseNo)}`)||null}));const winner=known.find(r=>r.finishPosition===1);
  if(!known.some(r=>r.finishPosition)){missingResults++;details.push({raceKey:l.raceKey,sealedAt:l.sealedAt,evaluated:false});continue}
  races++;const one=known.find(r=>Number(r.rank)===1);if(one?.finishPosition===1)top1Win++;if(one?.finishPosition&&one.finishPosition<=3)top1Top3++;if(one?.finishPosition){top1FinishSum+=one.finishPosition;top1FinishN++}if(winner&&Number(winner.rank)<=3)top3Winner++;if(winner&&Number(winner.rank)<=5)top5Winner++;
  details.push({raceKey:l.raceKey,sealedAt:l.sealedAt,evaluated:true,top1:one?{horseNo:Number(one.horseNo),horseName:one.horseName,finishPosition:one.finishPosition}:null,winner:winner?{horseNo:Number(winner.horseNo),horseName:winner.horseName,laboRank:Number(winner.rank)}:null});
 }
 const latestUser=new Map();for(const x of [...userRevisions].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))))if(!latestUser.has(x.raceKey))latestUser.set(x.raceKey,x);
 let userRaces=0,userMainWin=0,userMainTop3=0;for(const u of latestUser.values()){let a;try{a=typeof u.audit==='string'?JSON.parse(u.audit):u.audit}catch{continue}const marked=a?.audit?.marked||a?.marked||[];const main=marked.find(x=>x.mark==='◎');if(!main)continue;const p=finish.get(`${u.raceKey}:${Number(main.horseNo)}`);if(!p)continue;userRaces++;if(p===1)userMainWin++;if(p<=3)userMainTop3++}
 return{evaluatedRaces:races,missingResultRaces:missingResults,labo:{top1Wins:top1Win,top1WinRate:pct(top1Win,races),top1Top3:top1Top3,top1Top3Rate:pct(top1Top3,races),top3WinnerCoverage:top3Winner,top3WinnerCoverageRate:pct(top3Winner,races),top5WinnerCoverage:top5Winner,top5WinnerCoverageRate:pct(top5Winner,races),averageTop1Finish:top1FinishN?Math.round(top1FinishSum/top1FinishN*100)/100:null},user:{evaluatedRaces:userRaces,mainWins:userMainWin,mainWinRate:pct(userMainWin,userRaces),mainTop3:userMainTop3,mainTop3Rate:pct(userMainTop3,userRaces)},details,guardrails:{prospectiveLockedPredictionsOnly:true,resultsUsedOnlyForEvaluation:true,noHistoricalReconstruction:true,noScoreMutation:true}};
}
