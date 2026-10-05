export const REPLAY_EVIDENCE={VERIFIED:'VERIFIED',LEGACY:'LEGACY_SAVED',REPLAY:'RESULT_BLIND_REPLAY',NONE:'NO_RECORD'};
export function assignReplayMarks(runners=[]){
 const sorted=[...runners].filter(x=>Number.isFinite(Number(x.evidenceScore))).sort((a,b)=>Number(b.evidenceScore)-Number(a.evidenceScore)||Number(b.confidencePct||0)-Number(a.confidencePct||0)||Number(a.horseNo)-Number(b.horseNo));
 const marks=['◎','○','▲','△','△'];
 return sorted.map((x,i)=>({...x,replayRank:i+1,mark:marks[i]||''}));
}
export function validateReplay({raceDate,startAt,sourceUrl,ranking}={}){
 const start=Date.parse(startAt||'');
 if(!Number.isFinite(start)||!sourceUrl)return{eligible:false,reason:'verified race-start evidence is required'};
 if(!ranking?.leakageGuard||!String(ranking.leakageGuard).includes('race_date <'))return{eligible:false,reason:'ranking does not prove pre-target history cutoff'};
 if(ranking.finalPrediction!==false)return{eligible:false,reason:'unexpected ranking contract'};
 if(!Array.isArray(ranking.runners)||!ranking.runners.length)return{eligible:false,reason:'no replay runners'};
 if(ranking.race?.date!==raceDate)return{eligible:false,reason:'replay race identity mismatch'};
 return{eligible:true,reason:'result-blind diagnostic replay; histories restricted before target race date'};
}
