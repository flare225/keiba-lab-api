export const REPLAY_EVIDENCE={VERIFIED:'VERIFIED',LEGACY:'LEGACY_SAVED',REPLAY:'RESULT_BLIND_REPLAY',NONE:'NO_RECORD'};
export const OFFICIAL_CUTOFFS={'2026-10-04:東京:11':{raceStartAt:'2026-10-04T15:45:00+09:00',source:'JRA official race programme/result',verified:true}};
export const markForRank=r=>({1:'◎',2:'○',3:'▲',4:'△',5:'☆'})[Number(r)]||null;
export function cutoffFor(raceKey){return OFFICIAL_CUTOFFS[raceKey]||null}
export function legacySnapshotEligible(rows=[],runnerCount,cutoff){
 const t=Date.parse(cutoff||'');if(!Number.isFinite(t)||!runnerCount)return false;
 const xs=rows.filter(x=>Number.isFinite(Date.parse(x.generated_at))&&Date.parse(x.generated_at)<t);
 return xs.length===Number(runnerCount)&&new Set(xs.map(x=>Number(x.horse_no))).size===Number(runnerCount);
}
export function normalizeReplayRanking(rows=[],scoreKey='evidenceScore'){
 return rows.slice().sort((a,b)=>Number(b[scoreKey]??-1)-Number(a[scoreKey]??-1)||Number(a.horseNo)-Number(b.horseNo)).map((x,i)=>({...x,rank:i+1,mark:markForRank(i+1)}));
}

export function hasCompleteReplayScores(rows=[]){return rows.length>0&&rows.every(x=>x.evidenceScore!=null&&x.evidenceScore!==''&&Number.isFinite(Number(x.evidenceScore)))}
